import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileText,
  GraduationCap,
  ListTree,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Coverage, DocumentRecord, Topic } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Input, Select, Textarea } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { cn, priorityStyle, statusLabels, statusStyle } from "../lib/utils";

export default function Syllabus() {
  const { subjects } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [subjectId, setSubjectId] = useState<number | null>(params.get("subject") ? Number(params.get("subject")) : subjects[0]?.id ?? null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsingId, setParsingId] = useState<number | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [tab, setTab] = useState("topics");
  const [detail, setDetail] = useState<Topic | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newTopic, setNewTopic] = useState({ title: "", module: "General", description: "", priority: "medium", marks: 0 });

  useEffect(() => {
    if (subjectId === null && subjects.length > 0) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  const load = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    try {
      const [documentsData, topicsData, coverageData] = await Promise.all([
        api.documents(subjectId),
        api.topics(subjectId),
        api.coverage(subjectId),
      ]);
      setDocuments(documentsData);
      setTopics(topicsData);
      setCoverage(coverageData);
    } catch (error) {
      toast("Could not load syllabus", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoading(false);
    }
  }, [subjectId, toast]);

  useEffect(() => { load(); }, [load]);

  const selectSubject = (value: string) => {
    const id = Number(value);
    setSubjectId(id);
    const next = new URLSearchParams(params);
    next.set("subject", value);
    setParams(next, { replace: true });
  };

  const syllabusDocs = documents.filter((document) => document.doc_kind === "syllabus" || document.filename.toLowerCase().includes("syllab"));
  const modules = useMemo(() => {
    const map = new Map<string, Topic[]>();
    topics.forEach((topic) => {
      const list = map.get(topic.module) || [];
      list.push(topic);
      map.set(topic.module, list);
    });
    return Array.from(map.entries());
  }, [topics]);

  const parse = async (document: DocumentRecord) => {
    if (!subjectId) return;
    setParsingId(document.id);
    try {
      const result = await api.parseSyllabus(subjectId, document.id, useAi);
      toast("Syllabus analysed", `${result.count} topics extracted. Priority reasons are available on each topic.`, "success");
      await load();
      setTab("topics");
    } catch (error) {
      toast("Could not parse syllabus", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setParsingId(null);
    }
  };

  const updateTopic = async (topic: Topic, patch: Record<string, unknown>) => {
    try {
      const updated = await api.updateTopic(topic.id, patch);
      setTopics((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (detail?.id === updated.id) setDetail(updated);
      if (patch.status === "mastered") toast("Marked mastered", "Manual override recorded. Mastery from quizzes is more reliable.", "info");
    } catch (error) {
      toast("Could not update topic", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const addTopic = async () => {
    if (!subjectId || !newTopic.title.trim()) {
      toast("Topic title required", undefined, "warning");
      return;
    }
    try {
      await api.createTopic({ subject_id: subjectId, ...newTopic });
      toast("Topic added", newTopic.title, "success");
      setAddOpen(false);
      setNewTopic({ title: "", module: "General", description: "", priority: "medium", marks: 0 });
      await load();
    } catch (error) {
      toast("Could not add topic", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const removeTopic = async (topic: Topic) => {
    if (!window.confirm(`Delete “${topic.title}” and its teaching progress?`)) return;
    try {
      await api.deleteTopic(topic.id);
      setDetail(null);
      toast("Topic deleted", topic.title, "success");
      await load();
    } catch (error) {
      toast("Could not delete topic", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  if (subjects.length === 0) {
    return (
      <div>
        <PageHeader title="Syllabus Analyser" subtitle="Extract modules, units and topics from university syllabi." />
        <EmptyState icon={ListTree} title="Create a subject first" description="Syllabus topics belong to a subject. Create one, then upload the syllabus." action={<Button onClick={() => navigate("/subjects")}>Create subject <ArrowRight size={14} /></Button>} />
      </div>
    );
  }

  const completed = topics.filter((topic) => topic.status === "mastered" || topic.status === "learned").length;
  const mastered = topics.filter((topic) => topic.status === "mastered").length;
  const subject = subjects.find((item) => item.id === subjectId);

  return (
    <div>
      <PageHeader
        title="Syllabus Analyser"
        subtitle="Turn a university syllabus into an interactive topic map with evidence-based study priorities."
        actions={
          <div className="flex items-center gap-2">
            <Select value={subjectId || ""} onChange={(event) => selectSubject(event.target.value)} className="w-52">
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Button variant="outline" onClick={() => setAddOpen(true)}><Plus size={15} /> Add topic</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Topics</p><p className="mt-1 font-display text-2xl font-semibold">{topics.length}</p></div>
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">High priority</p><p className="mt-1 font-display text-2xl font-semibold text-danger">{topics.filter((topic) => topic.priority === "high").length}</p></div>
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Learned / mastered</p><p className="mt-1 font-display text-2xl font-semibold text-success">{completed}</p></div>
        <div className="glass-panel p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes coverage</p><p className="mt-1 font-display text-2xl font-semibold">{coverage ? `${coverage.covered}/${coverage.total_topics}` : "—"}</p></div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 w-fit"
        items={[
          { id: "topics", label: "Topic map", icon: ListTree, count: topics.length },
          { id: "coverage", label: "Notes coverage", icon: MapPin, count: coverage?.missing_count },
          { id: "documents", label: "Syllabus documents", icon: FileText, count: syllabusDocs.length },
        ]}
      />

      {loading ? <div className="py-16"><Spinner label="Loading syllabus" /></div> : null}

      {!loading && tab === "documents" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Analyse a syllabus document</CardTitle>
              <p className="text-xs text-muted-foreground">Upload a syllabus in the Knowledge Base, then parse it here. Uploaded PDFs/DOCX files are never modified.</p>
            </CardHeader>
            <CardContent>
              {syllabusDocs.length === 0 ? (
                <EmptyState icon={FileText} title="No syllabus uploaded" description="Upload a syllabus file with the kind set to “Syllabus”. File names containing “syllabus” are detected automatically." action={<Button onClick={() => navigate(`/documents?subject=${subjectId}`)}>Open Knowledge Base</Button>} className="py-8" />
              ) : (
                <div className="space-y-2">
                  {syllabusDocs.map((document) => (
                    <div key={document.id} className="flex flex-col gap-3 rounded-xl border border-border bg-muted/25 p-3 sm:flex-row sm:items-center">
                      <FileText size={18} className="text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{document.filename}</p>
                        <p className="text-[11px] text-muted-foreground">{document.page_count} pages · {document.status}</p>
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} className="accent-[hsl(var(--accent))]" />
                        Use AI parser if configured
                      </label>
                      <Button size="sm" onClick={() => parse(document)} loading={parsingId === document.id} disabled={document.status !== "ready"}>
                        <Wand2 size={14} /> Parse syllabus
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-3 p-4 text-xs leading-5 text-muted-foreground">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
              <p>Priority scores use marks, assessment verbs, question-paper frequency, module position and practical relevance found in your documents. They are study aids, not examination predictions. Always verify against your official syllabus.</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!loading && tab === "coverage" && coverage ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Notes mapped to syllabus</p>
                <span className="text-xs text-muted-foreground">{coverage.covered} of {coverage.total_topics} topics have matching notes</span>
              </div>
              <Progress value={coverage.total_topics ? (coverage.covered / coverage.total_topics) * 100 : 0} className="mt-3" />
              <p className="mt-2 text-[11px] text-muted-foreground">{coverage.note}</p>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 size={15} className="text-success" /> Covered topics</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {coverage.mapped.length === 0 ? <p className="text-xs text-muted-foreground">No topics matched yet.</p> : coverage.mapped.map((entry) => (
                  <div key={entry.topic_id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <p className="text-xs font-medium">{entry.title}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{entry.matches.length} matching passage(s)</p>
                    {entry.matches[0] ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">“{entry.matches[0].snippet}”</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle size={15} className="text-warning" /> Missing material</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {coverage.missing.length === 0 ? <p className="text-xs text-success">Every parsed topic has some matching notes.</p> : coverage.missing.map((entry) => (
                  <button key={entry.topic_id} onClick={() => navigate(`/learn/${entry.topic_id}`)} className="flex w-full items-center gap-2 rounded-xl border border-warning/20 bg-warning/5 p-3 text-left transition hover:border-warning/40">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.title}</span>
                    <Badge className="border-warning/25 text-warning">No notes</Badge>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {!loading && tab === "topics" ? (
        topics.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No topics parsed yet"
            description={syllabusDocs.length ? "Parse your uploaded syllabus to build the topic map." : "Upload a syllabus document first, then analyse it."}
            action={<Button onClick={() => setTab("documents")}><Sparkles size={15} /> Open syllabus documents</Button>}
          />
        ) : (
          <div className="space-y-5">
            {modules.map(([module, moduleTopics]) => (
              <Card key={module}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><BookOpenCheck size={16} className="text-primary" /> {module}</CardTitle>
                  <Badge>{moduleTopics.length} topics</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  {moduleTopics.map((topic) => (
                    <div key={topic.id} className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 transition hover:border-primary/30 sm:flex-row sm:items-center">
                      <button onClick={() => setDetail(topic)} className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{topic.title}</p>
                          <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider", priorityStyle[topic.priority])}>{topic.priority}</span>
                          {topic.marks ? <Badge>{topic.marks} marks</Badge> : null}
                        </div>
                        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{topic.priority_reason}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={topic.mastery_score} className="h-1 max-w-36" />
                          <span className="text-[10px] text-muted-foreground">{Math.round(topic.mastery_score)}% mastery</span>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <Select
                          value={topic.status}
                          onChange={(event) => updateTopic(topic, { status: event.target.value })}
                          className={cn("h-8 w-32 text-[11px]", statusStyle[topic.status])}
                        >
                          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </Select>
                        <Button size="sm" onClick={() => navigate(`/learn/${topic.id}`)}>Teach <ArrowRight size={12} /></Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title} description={detail ? `${detail.module} · ${detail.priority.toUpperCase()} priority` : ""} size="lg">
        {detail ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/25 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Priority score</p><p className="mt-1 font-display text-xl font-semibold">{detail.priority_score}</p></div>
              <div className="rounded-xl border border-border bg-muted/25 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Marks signal</p><p className="mt-1 font-display text-xl font-semibold">{detail.marks || "—"}</p></div>
              <div className="rounded-xl border border-border bg-muted/25 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mastery</p><p className="mt-1 font-display text-xl font-semibold">{Math.round(detail.mastery_score)}%</p></div>
            </div>
            {detail.description ? <div><p className="label">Syllabus description</p><p className="text-sm leading-6 text-muted-foreground">{detail.description}</p></div> : null}
            {detail.learning_outcome ? <div><p className="label">Learning outcome</p><p className="text-sm leading-6 text-muted-foreground">{detail.learning_outcome}</p></div> : null}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles size={13} /> Why this priority</p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail.priority_reason}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => navigate(`/learn/${detail.id}`)}><GraduationCap size={15} /> Open teaching workspace</Button>
              <Button variant="outline" onClick={() => { setDetail(null); setTab("coverage"); }}><MapPin size={14} /> Check notes coverage</Button>
              <Button variant="danger" size="sm" onClick={() => removeTopic(detail)}><Trash2 size={13} /> Delete</Button>
            </div>
            <p className="text-[10px] leading-5 text-muted-foreground">Priority is derived from available signals in your uploaded files. It is not a guarantee that a topic will appear in an examination.</p>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a custom topic"
        description={`Add a topic to ${subject?.name || "the selected subject"}.`}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={addTopic}>Add topic</Button></div>}
      >
        <div className="space-y-3">
          <div><label className="label">Title *</label><Input value={newTopic.title} onChange={(event) => setNewTopic({ ...newTopic, title: event.target.value })} placeholder="Adaptive filters" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Module</label><Input value={newTopic.module} onChange={(event) => setNewTopic({ ...newTopic, module: event.target.value })} /></div>
            <div><label className="label">Marks (optional)</label><Input type="number" value={newTopic.marks} onChange={(event) => setNewTopic({ ...newTopic, marks: Number(event.target.value) })} /></div>
          </div>
          <div><label className="label">Priority</label><Select value={newTopic.priority} onChange={(event) => setNewTopic({ ...newTopic, priority: event.target.value })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select></div>
          <div><label className="label">Description</label><Textarea value={newTopic.description} onChange={(event) => setNewTopic({ ...newTopic, description: event.target.value })} placeholder="What should you be able to do after studying this topic?" /></div>
        </div>
      </Dialog>

      {topics.length > 0 ? (
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <RefreshCw size={11} /> Re-parsing preserves progress on topics whose titles match.
        </p>
      ) : null}
      {!subjectId ? <p className="mt-4 text-xs text-muted-foreground">Select a subject to begin.</p> : null}
      {subjectId && documents.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No documents in this subject yet. <Link to={`/documents?subject=${subjectId}`} className="text-primary hover:underline">Upload study material</Link>.
        </p>
      ) : null}
    </div>
  );
}
