import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Layers, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Flashcard, Topic } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { Markdown } from "../components/ui/Markdown";
import { formatDate, formatDateTime } from "../lib/utils";

const grades = [
  { grade: 1, label: "Again", hint: "forgot", tone: "border-danger/30 text-danger hover:bg-danger/[0.08]" },
  { grade: 3, label: "Hard", hint: "difficult", tone: "border-warning/30 text-warning hover:bg-warning/[0.08]" },
  { grade: 4, label: "Good", hint: "recalled", tone: "border-primary/30 text-primary hover:bg-primary/[0.08]" },
  { grade: 5, label: "Easy", hint: "instant", tone: "border-success/30 text-success hover:bg-success/[0.08]" },
];

export default function Revision() {
  const { subjects } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("review");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [due, setDue] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [subjectId, setSubjectId] = useState<number | "">(subjects[0]?.id ?? "");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [count, setCount] = useState(12);
  const [generating, setGenerating] = useState(false);

  const current = due[index] || null;
  const remaining = useMemo(() => Math.max(0, due.length - index), [due.length, index]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, dueNow] = await Promise.all([api.flashcards(), api.dueFlashcards()]);
      setCards(all);
      setDue(dueNow);
      setIndex(0);
      setRevealed(false);
    } catch (error) {
      toast("Could not load flashcards", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (subjectId === "") { setTopics([]); setTopicId(""); return; }
    api.topics(Number(subjectId)).then(setTopics).catch(() => setTopics([]));
    setTopicId("");
  }, [subjectId]);

  useEffect(() => {
    if (subjects.length && subjectId === "") setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  const grade = async (value: number) => {
    if (!current) return;
    setGrading(true);
    try {
      await api.reviewFlashcard(current.id, value);
      setIndex((currentIndex) => currentIndex + 1);
      setRevealed(false);
      if (index + 1 >= due.length) {
        toast("Review session complete", "Next review dates were scheduled with spaced repetition.", "success");
        await load();
      }
    } catch (error) {
      toast("Could not record review", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setGrading(false);
    }
  };

  const generate = async () => {
    if (subjectId === "") { toast("Select a subject", undefined, "warning"); return; }
    setGenerating(true);
    try {
      const created = await api.generateFlashcards(Number(subjectId), topicId === "" ? undefined : Number(topicId), count);
      toast("Flashcards generated", `${created.length} cards added to your review queue.`, "success");
      await load();
      setTab("review");
    } catch (error) {
      toast("Could not generate flashcards", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setGenerating(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Delete this flashcard?")) return;
    await api.deleteFlashcard(id);
    setCards((items) => items.filter((item) => item.id !== id));
    setDue((items) => items.filter((item) => item.id !== id));
    toast("Flashcard deleted", undefined, "success");
  };

  return (
    <div>
      <PageHeader
        title="Spaced Revision"
        subtitle="SM-2 style scheduling keeps difficult cards in rotation and pushes mastered cards further out."
        actions={<Button variant="outline" onClick={load}><RotateCcw size={15} /> Refresh</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due now</p><p className="mt-1 font-display text-2xl font-semibold text-primary">{due.length}</p></div>
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total cards</p><p className="mt-1 font-display text-2xl font-semibold">{cards.length}</p></div>
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Average ease</p><p className="mt-1 font-display text-2xl font-semibold">{cards.length ? (cards.reduce((sum, card) => sum + card.ease, 0) / cards.length).toFixed(2) : "—"}</p></div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 w-fit"
        items={[{ id: "review", label: "Review", icon: Layers, count: due.length }, { id: "generate", label: "Generate", icon: Sparkles }, { id: "library", label: "Library", icon: CalendarClock, count: cards.length }]}
      />

      {tab === "review" ? (
        loading ? <div className="py-16"><Spinner label="Preparing review queue" /></div> : !current ? (
          <EmptyState icon={Layers} title="Queue empty" description="No cards are due right now. Generate new cards or come back when your next review is scheduled." action={cards.length === 0 ? <Button onClick={() => setTab("generate")}>Generate flashcards</Button> : <Button variant="outline" onClick={() => setTab("library")}>Browse library</Button>} />
        ) : (
          <div className="mx-auto max-w-2xl">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Card {index + 1} of {due.length}</span>
              <span>{remaining} remaining</span>
            </div>
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${(index / due.length) * 100}%` }} /></div>
            <button onClick={() => setRevealed((value) => !value)} className="glass-panel flex min-h-[280px] w-full flex-col items-center justify-center gap-4 p-8 text-center transition hover:border-primary/30">
              <Badge>{current.topic_title}</Badge>
              <p className="font-display text-lg font-medium leading-8">{current.front}</p>
              {revealed ? <div className="w-full border-t border-border pt-4 text-left"><Markdown content={current.back} /></div> : <p className="text-xs text-muted-foreground">Click to reveal the answer</p>}
            </button>
            {revealed ? (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {grades.map((item) => (
                  <button key={item.grade} onClick={() => grade(item.grade)} disabled={grading} className={`rounded-xl border bg-card/40 py-3 text-center transition disabled:opacity-50 ${item.tone}`}>
                    <p className="text-xs font-semibold">{item.label}</p>
                    <p className="text-[9px] opacity-70">{item.hint}</p>
                  </button>
                ))}
              </div>
            ) : (
              <Button className="mt-4 w-full" size="lg" onClick={() => setRevealed(true)}>Reveal answer</Button>
            )}
            <p className="mt-3 text-center text-[10px] text-muted-foreground">Grade honestly — the scheduler adapts intervals from your recall quality.</p>
          </div>
        )
      ) : null}

      {tab === "generate" ? (
        <Card className="mx-auto max-w-xl">
          <CardHeader><CardTitle>Create revision cards</CardTitle><p className="text-xs text-muted-foreground">Cards are generated from your material and existing quiz mistakes, then scheduled for today.</p></CardHeader>
          <CardContent className="space-y-4">
            <div><label className="label">Subject</label><Select value={subjectId} onChange={(event) => setSubjectId(event.target.value === "" ? "" : Number(event.target.value))}><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select></div>
            <div><label className="label">Topic (optional)</label><Select value={topicId} onChange={(event) => setTopicId(event.target.value === "" ? "" : Number(event.target.value))}><option value="">All topics</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</Select></div>
            <div><label className="label">Number of cards</label><Input type="number" min={3} max={40} value={count} onChange={(event) => setCount(Number(event.target.value))} /></div>
            <Button variant="gradient" className="w-full" onClick={generate} loading={generating}><Sparkles size={15} /> Generate flashcards</Button>
            {subjects.length === 0 ? <p className="text-[11px] text-warning">Create a subject and upload material first. <button className="underline" onClick={() => navigate("/subjects")}>Go to subjects</button></p> : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === "library" ? (
        loading ? <div className="py-16"><Spinner /></div> : cards.length === 0 ? (
          <EmptyState icon={Layers} title="No flashcards" description="Generate cards to begin spaced repetition." action={<Button onClick={() => setTab("generate")}>Generate flashcards</Button>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {cards.map((card) => (
              <Card key={card.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><Badge>{card.topic_title}</Badge><Badge>ease {card.ease.toFixed(2)}</Badge><Badge>{card.interval_days}d interval</Badge></div>
                      <p className="mt-2 text-sm font-medium leading-6">{card.front}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{card.back}</p>
                      <p className="mt-2 text-[10px] text-muted-foreground">Next review: {formatDate(card.due_date)} · {card.total_reviews} reviews</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(card.id)} aria-label="Delete flashcard"><Trash2 size={14} className="text-danger" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

