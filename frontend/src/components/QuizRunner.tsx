import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  Clock,
  RotateCcw,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Quiz, QuizAttempt } from "../lib/types";
import { cn, qtypeLabels } from "../lib/utils";
import { useToast } from "./ui/Toast";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Markdown } from "./ui/Markdown";
import { Spinner } from "./ui/Spinner";

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function ScoreRing({ percent }: { percent: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  const color = percent >= 70 ? "hsl(var(--success))" : percent >= 40 ? "hsl(var(--warning))" : "hsl(var(--danger))";
  return (
    <div className="relative h-36 w-36">
      <svg className="-rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-semibold">{Math.round(percent)}%</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">score</span>
      </div>
    </div>
  );
}

export function QuizRunner({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const { toast } = useToast();
  const questions = quiz.questions || [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [warn, setWarn] = useState(false);
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const startedAt = useRef(Date.now());
  const submitRef = useRef<() => void>(() => undefined);
  const finishing = useRef(false);

  const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  const answered = questions.filter((question) => (answers[String(question.id)] || "").trim().length > 0).length;
  const limit = quiz.duration_minutes * 60;
  const remaining = quiz.duration_minutes > 0 ? Math.max(0, limit - elapsed) : 0;

  const submit = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting(true);
    setWarn(false);
    try {
      const duration = Math.round((Date.now() - startedAt.current) / 1000);
      const result = await api.submitQuiz(quiz.id, answers, duration);
      setAttempt(result);
      toast("Quiz evaluated", `${result.percent}% — ${result.score}/${result.max_score} marks`, result.percent >= 70 ? "success" : "warning");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast("Could not submit quiz", error instanceof ApiError ? error.message : "Unexpected error", "error");
      finishing.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [answers, quiz.id, toast]);

  submitRef.current = submit;

  useEffect(() => {
    if (attempt) return;
    const timer = window.setInterval(() => {
      const value = Math.round((Date.now() - startedAt.current) / 1000);
      setElapsed(value);
      if (quiz.duration_minutes > 0 && value >= quiz.duration_minutes * 60) {
        submitRef.current();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, quiz.duration_minutes]);

  const handleSubmitClick = () => {
    const unanswered = questions.length - answered;
    if (unanswered > 0 && !warn) {
      setWarn(true);
      return;
    }
    submit();
  };

  const saveQuestion = async (questionId: number) => {
    const entry = attempt?.feedback.find((item) => item.question_id === questionId);
    if (!entry) return;
    try {
      await api.saveQuestion({
        subject_id: quiz.subject_id,
        topic_id: quiz.topic_id,
        qtype: entry.qtype,
        prompt: entry.prompt,
        answer: entry.correct_answer,
        explanation: entry.explanation,
        source: entry.source,
      });
      setSaved((current) => ({ ...current, [questionId]: true }));
      toast("Question saved", "Find it in Practice → Saved.", "success");
    } catch (error) {
      toast("Could not save question", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const retry = () => {
    setAnswers({});
    setAttempt(null);
    setWarn(false);
    setElapsed(0);
    startedAt.current = Date.now();
    finishing.current = false;
  };

  if (attempt) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card/60 p-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-5">
            <ScoreRing percent={attempt.percent} />
            <div>
              <h2 className="font-display text-xl font-semibold">{attempt.percent >= 70 ? "Well done" : "Keep building"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {attempt.score} / {attempt.max_score} marks · {formatClock(attempt.duration_seconds)} · {quiz.generator === "ai+material" ? "AI + notes" : "Notes grounded"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className={attempt.percent >= 70 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}>
                  {attempt.percent >= 85 ? "Mastery level" : attempt.percent >= 70 ? "Passed" : "Needs revision"}
                </Badge>
                {quiz.topic_id && attempt.percent >= 70 ? <Badge>Topic marked learned</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={retry}><RotateCcw size={15} /> Retake</Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>

        <div className="space-y-3">
          {attempt.feedback.map((entry, index) => (
            <div
              key={entry.question_id}
              className={cn(
                "rounded-2xl border bg-card/60 p-5",
                entry.correct ? "border-success/25" : entry.score > 0 ? "border-warning/25" : "border-danger/25",
              )}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold", entry.correct ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger")}>
                    {index + 1}
                  </span>
                  <Badge>{qtypeLabels[entry.qtype] || entry.qtype}</Badge>
                  <span className="text-xs text-muted-foreground">{entry.score} / {entry.marks} marks</span>
                </div>
                <div className="flex items-center gap-2">
                  {entry.correct ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />}
                  <Button variant="ghost" size="sm" onClick={() => saveQuestion(entry.question_id)} disabled={saved[entry.question_id]}>
                    <BookmarkPlus size={13} /> {saved[entry.question_id] ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>
              <p className="text-sm font-medium leading-6">{entry.prompt}</p>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
                  <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">Your answer</p>
                  <p className="whitespace-pre-wrap text-foreground/90">{entry.student_answer || "No answer"}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
                  <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">Reference answer</p>
                  <p className="whitespace-pre-wrap text-foreground/90">{entry.correct_answer || "—"}</p>
                </div>
              </div>
              {entry.note ? <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">{entry.note}</p> : null}
              {entry.improvement && entry.improvement !== entry.note ? (
                <p className="mt-2 text-xs leading-5 text-warning">{entry.improvement}</p>
              ) : null}
              {entry.explanation ? <div className="mt-3 border-t border-border/60 pt-3"><Markdown content={entry.explanation} className="text-xs" /></div> : null}
              {entry.source && "document" in entry.source ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Source: {String(entry.source.document)} · page {String(entry.source.page)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/90 px-4 py-3 backdrop-blur-xl">
        <div>
          <h2 className="font-display text-base font-semibold">{quiz.title}</h2>
          <p className="text-xs text-muted-foreground">
            {questions.length} questions · {totalMarks} marks · {quiz.mode.replace("_", " ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs", quiz.duration_minutes > 0 && remaining < 60 ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-muted/60 text-muted-foreground")}>
            <Clock size={13} />
            {quiz.duration_minutes > 0 ? formatClock(remaining) : formatClock(elapsed)}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><ChevronLeft size={14} /> Exit</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(answered / Math.max(1, questions.length)) * 100}%` }} />
        </div>
        {answered} / {questions.length} answered
      </div>

      <div className="space-y-3">
        {questions.map((question, index) => (
          <div key={question.id} className="rounded-2xl border border-border bg-card/[0.55] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[11px] font-semibold text-primary">{index + 1}</span>
                <Badge>{qtypeLabels[question.qtype] || question.qtype}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">{question.marks} mark{question.marks > 1 ? "s" : ""}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm font-medium leading-6">{question.prompt}</p>
            {question.source && "document" in question.source ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Grounded in {String(question.source.document)}{question.source.page ? ` · page ${question.source.page}` : ""}</p>
            ) : null}

            {question.qtype === "mcq" || question.qtype === "true_false" ? (
              <div className="mt-4 grid gap-2">
                {question.options.map((option, optionIndex) => {
                  const selected = answers[String(question.id)] === option;
                  return (
                    <button
                      key={`${question.id}-${optionIndex}`}
                      type="button"
                      onClick={() => setAnswers((current) => ({ ...current, [String(question.id)]: option }))}
                      className={cn(
                        "focus-ring flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition",
                        selected ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                      )}
                    >
                      <span className={cn("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px]", selected ? "border-primary bg-primary text-white" : "border-border")}>
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="leading-6">{option}</span>
                    </button>
                  );
                })}
              </div>
            ) : question.qtype === "fill_blank" ? (
              <input
                value={answers[String(question.id)] || ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [String(question.id)]: event.target.value }))}
                placeholder="Type the missing term"
                className="focus-ring mt-4 h-10 w-full rounded-xl border border-border bg-muted/40 px-3.5 text-sm"
              />
            ) : (
              <textarea
                value={answers[String(question.id)] || ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [String(question.id)]: event.target.value }))}
                placeholder="Write your answer. Include definitions, equations, assumptions and units where relevant."
                rows={4}
                className="focus-ring mt-4 w-full resize-y rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm leading-6"
              />
            )}
          </div>
        ))}
      </div>

      {warn ? (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
          <AlertTriangle size={15} />
          {questions.length - answered} question(s) unanswered. Submit anyway?
          <Button variant="outline" size="sm" className="ml-auto" onClick={submit} loading={submitting}>Submit anyway</Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles size={13} /> Answers are evaluated against your indexed material and model answers.</p>
        <Button onClick={handleSubmitClick} loading={submitting} size="lg">
          <Trophy size={16} /> Submit for evaluation
        </Button>
      </div>
      {submitting ? <Spinner label="Evaluating answers" /> : null}
    </div>
  );
}
