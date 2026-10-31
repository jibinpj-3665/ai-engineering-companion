import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  Cpu,
  Eye,
  GraduationCap,
  Lightbulb,
  Loader2,
  MessagesSquare,
  PencilRuler,
  RotateCcw,
  Sigma,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Quiz, Source, TeachingContent, Topic, TopicProgress } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { Markdown } from "../components/ui/Markdown";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { QuizRunner } from "../components/QuizRunner";
import { Select } from "../components/ui/Input";
import { cn, priorityStyle, statusLabels } from "../lib/utils";

const phaseIcons = [Compass, Lightbulb, BookOpen, Sigma, Eye, PencilRuler, Cpu, GraduationCap, Brain, Trophy];

function TopicPicker() {
  const { subjects } = useApp();
  const navigate = useNavigate();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    api.topics(subjectId === "" ? undefined : Number(subjectId))
      .then(setTopics)
      .catch(() => setTopics([]))
      .finally(() => setLoading(false));
  }, [subjectId]);

  const filtered = useMemo(() => {
    if (!query.trim()) return topics;
    const lower = query.toLowerCase();
    return topics.filter((topic) => `${topic.title} ${topic.module} ${topic.subject_name}`.toLowerCase().includes(lower));
  }, [topics, query]);

  if (subjects.length === 0) {
    return (
      <div>
        <h1 className="mb-6 font-display text-2xl font-semibold">Step Teaching</h1>
        <EmptyState icon={GraduationCap} title="No subjects yet" description="Create a subject and parse its syllabus to start the 10-phase teaching workflow." action={<Button onClick={() => navigate("/subjects")}>Create subject</Button>} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Step Teaching</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Ten phases from real-world context to a mastery test. Progress is never auto-completed.</p>
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter topics…" className="focus-ring h-10 w-44 rounded-xl border border-border bg-muted/40 px-3 text-sm" />
          <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value === "" ? "" : Number(event.target.value))} className="w-48">
            <option value="">All subjects</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
        </div>
      </div>

      {loading ? <div className="py-20"><Spinner label="Loading topics" /></div> : filtered.length === 0 ? (
        <EmptyState icon={Brain} title="No topics yet" description="Parse your syllabus or add topics manually, then return here." action={<Button onClick={() => navigate("/syllabus")}>Open syllabus analyser</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((topic) => (
            <button key={topic.id} onClick={() => navigate(`/learn/${topic.id}`)} className="group glass-panel p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/[0.35]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[10px] text-muted-foreground">{topic.subject_name} · {topic.module}</p>
                  <p className="mt-1 line-clamp-2 font-display text-sm font-semibold">{topic.title}</p>
                </div>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", priorityStyle[topic.priority])}>{topic.priority}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Progress value={topic.mastery_score} className="h-1 flex-1" />
                <span className="text-[10px] text-muted-foreground">{Math.round(topic.mastery_score)}%</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Badge>{statusLabels[topic.status]}</Badge>
                <span className="flex items-center gap-1 text-[10px] text-primary">Teach <ChevronRight size={11} /></span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Learn() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const { settings, aiStatus } = useApp();
  const { toast } = useToast();
  const [progress, setProgress] = useState<TopicProgress | null>(null);
  const [content, setContent] = useState<TeachingContent | null>(null);
  const [phase, setPhase] = useState(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);

  const numericId = topicId ? Number(topicId) : null;

  const loadProgress = useCallback(async () => {
    if (!numericId) return;
    try {
      const data = await api.topicProgress(numericId);
      setProgress(data);
      return data;
    } catch (error) {
      toast("Could not load topic", error instanceof ApiError ? error.message : "Unexpected error", "error");
      return null;
    }
  }, [numericId, toast]);

  const loadPhase = useCallback(async (phaseId: number, regenerate = false) => {
    if (!numericId) return;
    setGenerating(true);
    try {
      const data = await api.teachPhase(numericId, phaseId, regenerate, settings?.personality || "study_buddy");
      setContent(data);
      setPhase(phaseId);
      setProgress((current) => current ? { ...current, viewed_phases: data.viewed_phases, progress_percent: data.progress_percent, mastery_passed: data.mastery_passed, topic: { ...current.topic, status: current.topic.status === "not_started" ? "in_progress" : current.topic.status } } : current);
    } catch (error) {
      toast("Could not generate phase", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setGenerating(false);
    }
  }, [numericId, settings?.personality, toast]);

  useEffect(() => {
    if (!numericId) return;
    setLoading(true);
    loadProgress().then((data) => {
      if (data) {
        const next = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((item) => !data.viewed_phases.includes(item)) || 1;
        loadPhase(next);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericId]);

  const generateMasteryQuiz = async () => {
    if (!progress) return;
    setQuizLoading(true);
    try {
      const created = await api.generateQuiz({
        subject_id: progress.topic.subject_id,
        topic_id: progress.topic.id,
        mode: "mastery",
        count: 10,
        title: `Mastery Test — ${progress.topic.title}`,
      });
      setQuiz(created);
      setQuizOpen(true);
    } catch (error) {
      toast("Could not generate mastery quiz", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setQuizLoading(false);
    }
  };

  if (!numericId) return <TopicPicker />;

  if (loading && !progress) return <div className="py-20"><Spinner label="Preparing teaching workspace" /></div>;

  if (!progress) {
    return <EmptyState icon={GraduationCap} title="Topic not found" description="It may have been deleted. Choose another topic to study." action={<Button onClick={() => navigate("/learn")}>Browse topics</Button>} />;
  }

  const topic = progress.topic;
  const phases = progress.phases;
  const viewed = new Set(content?.viewed_phases || progress.viewed_phases);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate("/learn")}><ArrowLeft size={14} /> All topics</Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{topic.title}</h1>
            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", priorityStyle[topic.priority])}>{topic.priority}</span>
            <Badge>{statusLabels[topic.status]}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{topic.subject_name} · {topic.module} · mastery {Math.round(topic.mastery_score)}%</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={topic.status}
            onChange={async (event) => {
              try {
                const updated = await api.updateTopic(topic.id, { status: event.target.value });
                setProgress({ ...progress, topic: updated });
              } catch {
                toast("Could not update status", undefined, "error");
              }
            }}
            className="h-9 w-36 text-xs"
          >
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Button variant="outline" onClick={() => navigate(`/tutor?ask=${encodeURIComponent(`Explain ${topic.title} at my current level.`)}`)}><MessagesSquare size={15} /> Ask tutor</Button>
          <Button onClick={generateMasteryQuiz} loading={quizLoading}><Trophy size={15} /> Mastery quiz</Button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Phase progress</span>
        <Progress value={content?.progress_percent ?? progress.progress_percent} className="max-w-xs flex-1" />
        <span className="text-[11px] text-muted-foreground">{Math.round(content?.progress_percent ?? progress.progress_percent)}%</span>
        <span className="ml-auto hidden text-[10px] text-muted-foreground sm:block">Mastery quizzes — not opened phases — mark topics complete.</span>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {phases.map((item, index) => {
          const Icon = phaseIcons[index] || BookOpen;
          const active = item.id === phase;
          const done = viewed.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => (item.id === phase ? undefined : loadPhase(item.id))}
              disabled={generating}
              className={cn(
                "flex min-w-[132px] flex-1 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition",
                active ? "border-primary/50 bg-primary/10" : "border-border bg-card/40 hover:border-primary/25",
              )}
            >
              <div className="flex items-center justify-between">
                <Icon size={14} className={active ? "text-primary" : "text-muted-foreground"} />
                {done ? <CheckCircle2 size={12} className="text-success" /> : <span className="text-[9px] text-muted-foreground">{item.id}/10</span>}
              </div>
              <p className={cn("text-[11px] font-medium leading-4", active ? "text-foreground" : "text-muted-foreground")}>{item.title}</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Phase {phase} of 10</p>
              <CardTitle className="mt-1 text-lg">{phases[phase - 1]?.title}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{phases[phase - 1]?.subtitle}</p>
            </div>
            {content ? (
              <Badge className={content.generator === "ai" ? "border-success/25 text-success" : ""}>
                {content.generator === "ai" ? <Sparkles size={10} /> : null}
                {content.generator === "ai" ? "AI generated" : "Material-grounded scaffold"}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {content?.note ? <p className="mb-3 rounded-lg border border-warning/25 bg-warning/[0.08] px-3 py-2 text-[11px] leading-5 text-warning">{content.note}</p> : null}
            {generating || !content ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin text-primary" /> Building this phase from your material…</div>
            ) : (
              <Markdown content={content.content} />
            )}
            {content && content.sources.length > 0 ? (
              <div className="mt-5 border-t border-border/70 pt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><BookOpen size={12} /> Citations used in this phase</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {content.sources.slice(0, 4).map((source) => (
                    <div key={`${source.document_id}-${source.page}-${source.index}`} className="rounded-lg border border-border/60 bg-muted/25 p-2.5">
                      <p className="text-[10px] font-medium text-primary">{source.document} · page {source.page}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{source.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Learning controls</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => loadPhase(phase, true)} disabled={generating}><RotateCcw size={13} /> Explain again</Button>
              <Button variant="outline" size="sm" onClick={() => loadPhase(2)} disabled={generating}><Lightbulb size={13} /> Simplify</Button>
              <Button variant="outline" size="sm" onClick={() => loadPhase(4)} disabled={generating}><Sigma size={13} /> Derivation</Button>
              <Button variant="outline" size="sm" onClick={() => loadPhase(6)} disabled={generating}><PencilRuler size={13} /> Example</Button>
              <Button variant="outline" size="sm" onClick={() => loadPhase(5)} disabled={generating}><Eye size={13} /> Diagram</Button>
              <Button variant="outline" size="sm" onClick={() => loadPhase(1)} disabled={generating}><Compass size={13} /> Real world</Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/visuals")}><Eye size={13} /> Visual Lab</Button>
              <Button variant="success" size="sm" onClick={generateMasteryQuiz} loading={quizLoading}><Trophy size={13} /> Test me</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Topic intelligence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Mastery</span><span>{Math.round(topic.mastery_score)}%</span></div>
                <Progress value={topic.mastery_score} className="mt-1.5" />
              </div>
              <p className="rounded-lg border border-primary/[0.15] bg-primary/5 p-2.5 text-[10px] leading-4 text-muted-foreground">{topic.priority_reason}</p>
              {aiStatus && !aiStatus.configured ? (
                <p className="text-[10px] leading-4 text-warning">Offline scaffolds are limited to your indexed material. Configure an AI provider for fuller derivations and worked examples.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center justify-between gap-2 p-3">
              <Button variant="ghost" size="sm" onClick={() => loadPhase(Math.max(1, phase - 1))} disabled={phase === 1 || generating}><ArrowLeft size={13} /> Previous</Button>
              <Button size="sm" onClick={() => loadPhase(Math.min(10, phase + 1))} disabled={phase === 10 || generating}>Next phase <ArrowRight size={13} /></Button>
            </CardContent>
          </Card>
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">Opening a phase records progress but never marks a topic complete. Pass the mastery quiz at 70% or higher to mark it learned; 85%+ marks mastery.</p>
        </div>
      </div>

      <Dialog open={quizOpen} onClose={() => setQuizOpen(false)} title={quiz?.title || "Mastery test"} description="Answers are evaluated against your material. No correct answers are shown before submission." size="xl">
        {quiz ? <QuizRunner quiz={quiz} onClose={() => { setQuizOpen(false); loadProgress(); }} /> : <Spinner label="Generating mastery test" />}
      </Dialog>
    </div>
  );
}
