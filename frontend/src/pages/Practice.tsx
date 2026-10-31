import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  ChevronRight,
  Clock,
  FileQuestion,
  History,
  PencilRuler,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Quiz, QuizAttempt, SavedQuestion, Topic } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Input, Select, Textarea } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { QuizRunner } from "../components/QuizRunner";
import { formatDateTime, qtypeLabels } from "../lib/utils";

const modes = [
  { id: "quick", label: "Quick Quiz", description: "10 mixed questions for a fast check." },
  { id: "topic", label: "Topic Test", description: "12 questions focused on one topic." },
  { id: "module", label: "Module Examination", description: "20 questions across a module." },
  { id: "model_exam", label: "University Model Exam", description: "2, 5 and 10 mark questions with a 90-minute window." },
  { id: "timed", label: "Timed Examination", description: "10 questions in 30 minutes." },
  { id: "viva", label: "Engineering Viva", description: "Oral-style questions to rehearse explanations." },
];

export default function Practice() {
  const { subjects } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("new");
  const [subjectId, setSubjectId] = useState<number | "">(subjects[0]?.id ?? "");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [mode, setMode] = useState("quick");
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("mixed");
  const [generating, setGenerating] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [saved, setSaved] = useState<SavedQuestion[]>([]);
  const [attemptDetail, setAttemptDetail] = useState<QuizAttempt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (subjectId === "" && subjects.length) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  useEffect(() => {
    if (subjectId === "") {
      setTopics([]);
      return;
    }
    api.topics(Number(subjectId)).then(setTopics).catch(() => setTopics([]));
    setTopicId("");
  }, [subjectId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [quizData, attemptData, savedData] = await Promise.all([
        api.quizzes(subjectId === "" ? undefined : Number(subjectId)),
        api.attempts(subjectId === "" ? undefined : Number(subjectId)),
        api.savedQuestions(),
      ]);
      setQuizzes(quizData);
      setAttempts(attemptData);
      setSaved(savedData);
    } catch (error) {
      toast("Could not load practice data", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoading(false);
    }
  }, [subjectId, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const generate = async () => {
    if (subjectId === "") {
      toast("Select a subject", "Quizzes are generated from a subject's material.", "warning");
      return;
    }
    setGenerating(true);
    try {
      const quiz = await api.generateQuiz({
        subject_id: Number(subjectId),
        topic_id: topicId === "" ? undefined : Number(topicId),
        mode,
        count: mode === "model_exam" ? undefined : count,
        difficulty,
      });
      setActiveQuiz(quiz);
      toast("Quiz generated", `${quiz.question_count} questions · ${quiz.generator === "material" ? "grounded in your notes" : "AI + notes"}`, "success");
      await loadData();
    } catch (error) {
      toast("Could not generate quiz", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setGenerating(false);
    }
  };

  const openQuiz = async (id: number) => {
    try {
      const quiz = await api.quiz(id);
      setActiveQuiz(quiz);
    } catch (error) {
      toast("Could not open quiz", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const removeQuiz = async (id: number) => {
    if (!window.confirm("Delete this quiz and its attempts?")) return;
    try {
      await api.deleteQuiz(id);
      toast("Quiz deleted", undefined, "success");
      await loadData();
    } catch (error) {
      toast("Could not delete quiz", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const removeSaved = async (id: number) => {
    await api.deleteSavedQuestion(id);
    setSaved((current) => current.filter((item) => item.id !== id));
    toast("Saved question removed", undefined, "success");
  };

  return (
    <div>
      <PageHeader
        title="Practice & Mock Exams"
        subtitle="Generate source-grounded questions, evaluate answers, and rehearse engineering viva."
        actions={
          <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value === "" ? "" : Number(event.target.value))} className="w-52">
            <option value="">All subjects</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 w-fit"
        items={[
          { id: "new", label: "Generate", icon: Sparkles },
          { id: "history", label: "Quizzes & attempts", icon: History, count: attempts.length },
          { id: "saved", label: "Saved questions", icon: Bookmark, count: saved.length },
        ]}
      />

      {tab === "new" ? (
        subjects.length === 0 ? (
          <EmptyState icon={PencilRuler} title="Create a subject first" description="Quizzes are generated from indexed study material." action={<Button onClick={() => navigate("/subjects")}>Create subject</Button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Build a new assessment</CardTitle>
                <p className="text-xs text-muted-foreground">Questions are generated from your uploaded material and syllabus. If an AI provider is configured, it can add richer numerical and programming questions.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Subject</label>
                    <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value === "" ? "" : Number(event.target.value))}>
                      <option value="">Select subject</option>
                      {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label className="label">Topic (optional)</label>
                    <Select value={topicId} onChange={(event) => setTopicId(event.target.value === "" ? "" : Number(event.target.value))}>
                      <option value="">Mixed / whole subject</option>
                      {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="label">Exam mode</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {modes.map((item) => (
                      <button key={item.id} onClick={() => { setMode(item.id); if (item.id === "model_exam") setCount(11); else if (item.id === "quick") setCount(10); else if (item.id === "topic") setCount(12); else if (item.id === "module") setCount(20); else setCount(10); }} className={`rounded-xl border p-3 text-left transition ${mode === item.id ? "border-primary/50 bg-primary/[0.08]" : "border-border bg-muted/25 hover:border-primary/25"}`}>
                        <p className="text-xs font-semibold">{item.label}</p>
                        <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{item.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label">Number of questions</label><Input type="number" min={3} max={50} value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={mode === "model_exam"} /></div>
                  <div><label className="label">Difficulty</label><Select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="mixed">Mixed</option><option value="easy">Foundation</option><option value="medium">University level</option><option value="hard">Advanced</option></Select></div>
                </div>
                <Button variant="gradient" size="lg" className="w-full" onClick={generate} loading={generating}><Sparkles size={16} /> Generate {modes.find((item) => item.id === mode)?.label}</Button>
                <p className="text-[10px] leading-4 text-muted-foreground">Timed modes start a countdown automatically. Model exams use 2/5/10 mark distribution and a 90-minute limit.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Trophy size={15} className="text-primary" /> Recent quizzes</CardTitle></CardHeader>
              <CardContent>
                {quizzes.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No quizzes yet.</p> : (
                  <div className="space-y-2">
                    {quizzes.slice(0, 6).map((quiz) => (
                      <div key={quiz.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-2.5">
                        <button onClick={() => openQuiz(quiz.id)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-xs font-medium">{quiz.title}</p>
                          <p className="text-[10px] text-muted-foreground">{quiz.question_count} questions · {quiz.mode.replace("_", " ")} · {formatDateTime(quiz.created_at)}</p>
                        </button>
                        <Button variant="ghost" size="icon-sm" onClick={() => openQuiz(quiz.id)} aria-label="Open quiz"><ChevronRight size={14} /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => removeQuiz(quiz.id)} aria-label="Delete quiz"><Trash2 size={13} className="text-danger" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )
      ) : null}

      {tab === "history" ? (
        loading ? <div className="py-16"><Spinner label="Loading attempts" /></div> : attempts.length === 0 ? (
          <EmptyState icon={History} title="No attempts yet" description="Generate a quiz and submit it to see marks, mistake analysis and improvement advice." action={<Button onClick={() => setTab("new")}>Generate quiz</Button>} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><History size={15} className="text-primary" /> Attempt history</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {attempts.map((attempt) => (
                  <button key={attempt.id} onClick={() => setAttemptDetail(attempt)} className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition hover:border-primary/30">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${attempt.percent >= 70 ? "border-success/25 bg-success/[0.08] text-success" : "border-warning/25 bg-warning/[0.08] text-warning"}`}>{Math.round(attempt.percent)}%</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{attempt.quiz_title}</span>
                      <span className="block text-[10px] text-muted-foreground">{attempt.score}/{attempt.max_score} marks · {formatDateTime(attempt.completed_at)}</span>
                    </span>
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FileQuestion size={15} className="text-primary" /> Recent quiz bank</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {quizzes.length === 0 ? <p className="text-xs text-muted-foreground">No quizzes generated for this subject.</p> : quizzes.map((quiz) => (
                  <div key={quiz.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{quiz.title}</p>
                      <p className="text-[10px] text-muted-foreground">{quiz.question_count} questions · {quiz.duration_minutes ? `${quiz.duration_minutes} min` : "untimed"} · {quiz.generator}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openQuiz(quiz.id)}>Open</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )
      ) : null}

      {tab === "saved" ? (
        saved.length === 0 ? (
          <EmptyState icon={Bookmark} title="No saved questions" description="After submitting a quiz, save questions for later revision." action={<Button onClick={() => setTab("new")}>Take a quiz</Button>} />
        ) : (
          <div className="space-y-2">
            {saved.map((question) => (
              <Card key={question.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><Badge>{qtypeLabels[question.qtype] || question.qtype}</Badge><Badge>{formatDateTime(question.created_at)}</Badge></div>
                      <p className="mt-2 text-sm font-medium leading-6">{question.prompt}</p>
                      {question.answer ? <p className="mt-2 rounded-lg bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">{question.answer}</p> : null}
                      {question.explanation ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{question.explanation}</p> : null}
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeSaved(question.id)} aria-label="Delete saved question"><Trash2 size={14} className="text-danger" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Dialog open={Boolean(activeQuiz)} onClose={() => { setActiveQuiz(null); loadData(); }} title={activeQuiz?.title} description="Complete every question, then submit for evaluation." size="xl">
        {activeQuiz ? <QuizRunner quiz={activeQuiz} onClose={() => { setActiveQuiz(null); loadData(); }} /> : null}
      </Dialog>

      <Dialog open={Boolean(attemptDetail)} onClose={() => setAttemptDetail(null)} title={attemptDetail?.quiz_title} description={attemptDetail ? `${attemptDetail.score}/${attemptDetail.max_score} marks · ${attemptDetail.percent}% · ${formatDateTime(attemptDetail.completed_at)}` : ""} size="xl">
        {attemptDetail ? (
          <div className="space-y-3">
            {attemptDetail.feedback.map((entry, index) => (
              <div key={entry.question_id} className={`rounded-xl border p-3.5 ${entry.correct ? "border-success/25 bg-success/[0.03]" : "border-danger/20 bg-danger/[0.02]"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><span className="text-xs font-semibold">Q{index + 1}</span><Badge>{qtypeLabels[entry.qtype] || entry.qtype}</Badge></div>
                  <span className="text-[11px] text-muted-foreground">{entry.score}/{entry.marks}</span>
                </div>
                <p className="mt-2 text-sm leading-6">{entry.prompt}</p>
                <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/40 p-2.5"><p className="font-semibold text-muted-foreground">Your answer</p><p className="mt-1 whitespace-pre-wrap">{entry.student_answer || "No answer"}</p></div>
                  <div className="rounded-lg bg-muted/40 p-2.5"><p className="font-semibold text-muted-foreground">Reference</p><p className="mt-1 whitespace-pre-wrap">{entry.correct_answer || "—"}</p></div>
                </div>
                {entry.note ? <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{entry.note}</p> : null}
                {entry.explanation ? <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{entry.explanation}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </Dialog>

      {attempts.length > 0 ? (
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock size={11} /> Time spent in exams contributes to weekly study analytics.</p>
      ) : null}
    </div>
  );
}
