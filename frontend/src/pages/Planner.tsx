import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  ListOrdered,
  Pause,
  Play,
  Plus,
  Square,
  Target,
  Trash2,
  Wand2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Exam, ScheduleSession, Topic } from "../lib/types";
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
import { Progress } from "../components/ui/Progress";
import { cn, dayLabel, formatDate, priorityStyle } from "../lib/utils";

const kinds = ["focus", "reading", "practice", "revision", "lab"];

export default function Planner() {
  const { subjects } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("plan");
  const [exams, setExams] = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [ranked, setRanked] = useState<{ id: number; title: string; subject: string; priority: string; mastery: number; score: number; exam_date: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [dailyMinutes, setDailyMinutes] = useState(120);
  const [horizonDays, setHorizonDays] = useState(14);
  const [examOpen, setExamOpen] = useState(false);
  const [examForm, setExamForm] = useState({ subject_id: subjects[0]?.id ?? 0, title: "University Examination", exam_date: "", weight: 100, notes: "" });
  const [savingExam, setSavingExam] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [examData, planData, rankedData] = await Promise.all([api.exams(), api.plan(14), api.rankedTopics()]);
      setExams(examData);
      setSessions(planData);
      setRanked(rankedData);
    } catch (error) {
      toast("Could not load planner", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!examForm.subject_id && subjects.length) setExamForm((form) => ({ ...form, subject_id: subjects[0].id })); }, [subjects, examForm.subject_id]);

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleSession[]>();
    sessions.forEach((session) => {
      const list = map.get(session.date) || [];
      list.push(session);
      map.set(session.date, list);
    });
    return Array.from(map.entries());
  }, [sessions]);

  const completedSessions = sessions.filter((session) => session.status === "completed").length;
  const plannedMinutes = sessions.reduce((sum, session) => sum + session.duration_minutes, 0);

  const generate = async () => {
    setGenerating(true);
    try {
      const result = await api.generatePlan(dailyMinutes, horizonDays);
      toast("Study plan generated", `${result.count} sessions across ${horizonDays} days.`, "success");
      await load();
    } catch (error) {
      toast("Could not generate plan", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setGenerating(false);
    }
  };

  const setStatus = async (session: ScheduleSession, status: string) => {
    try {
      const updated = await api.updateSchedule(session.id, status);
      setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, ...updated } : item)));
      if (status === "completed") toast("Session completed", `${session.duration_minutes} minutes logged to analytics.`, "success");
    } catch (error) {
      toast("Could not update session", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const createExam = async () => {
    if (!examForm.subject_id) { toast("Select a subject", undefined, "warning"); return; }
    if (!examForm.exam_date) { toast("Choose an exam date", undefined, "warning"); return; }
    setSavingExam(true);
    try {
      const created = await api.createExam({ ...examForm, exam_date: examForm.exam_date });
      setExams((current) => [...current, created].sort((a, b) => a.exam_date.localeCompare(b.exam_date)));
      setExamOpen(false);
      toast("Exam added", `${created.title} · ${formatDate(created.exam_date)}`, "success");
    } catch (error) {
      toast("Could not add exam", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSavingExam(false);
    }
  };

  const removeExam = async (id: number) => {
    if (!window.confirm("Delete this exam?")) return;
    await api.deleteExam(id);
    setExams((current) => current.filter((exam) => exam.id !== id));
  };

  return (
    <div>
      <PageHeader
        title="Study Planner"
        subtitle="Exam-aware scheduling, a ranked topic queue, and a focus timer that logs real study time."
        actions={<Button onClick={() => setExamOpen(true)}><Plus size={15} /> Add exam</Button>}
      />

      {exams.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {exams.slice(0, 4).map((exam) => (
            <div key={exam.id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs", exam.days_left <= 7 ? "border-danger/30 bg-danger/[0.08]" : "border-border bg-card/40")}>
              <CalendarDays size={13} className={exam.days_left <= 7 ? "text-danger" : "text-primary"} />
              <span className="font-medium">{exam.subject_name}</span>
              <span className="text-muted-foreground">{formatDate(exam.exam_date)} · {exam.days_left}d left</span>
              <button onClick={() => removeExam(exam.id)} aria-label="Delete exam"><Trash2 size={11} className="text-muted-foreground hover:text-danger" /></button>
            </div>
          ))}
        </div>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 w-fit"
        items={[{ id: "plan", label: "Study plan", icon: CalendarDays }, { id: "exams", label: "Exams", icon: Target, count: exams.length }, { id: "focus", label: "Focus timer", icon: Clock }]}
      />

      {tab === "plan" ? (
        loading ? <div className="py-16"><Spinner label="Loading plan" /></div> : (
          <div className="grid gap-4 xl:grid-cols-12">
            <div className="space-y-4 xl:col-span-8">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div><CardTitle>Generate a plan</CardTitle><p className="mt-1 text-xs text-muted-foreground">Prioritises high-weight, low-mastery topics and exam proximity.</p></div>
                  {sessions.length > 0 ? <Badge>{completedSessions}/{sessions.length} done</Badge> : null}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label className="label">Daily minutes</label><Input type="number" min={30} max={600} step={15} value={dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))} /></div>
                    <div><label className="label">Horizon</label><Select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}><option value={7}>7 days</option><option value={14}>14 days</option><option value={21}>21 days</option><option value={30}>30 days</option></Select></div>
                    <div className="flex items-end"><Button className="w-full" onClick={generate} loading={generating}><Wand2 size={15} /> Build plan</Button></div>
                  </div>
                  {sessions.length > 0 ? <p className="mt-3 text-[11px] text-muted-foreground">{plannedMinutes} minutes planned · completing a session logs it automatically.</p> : null}
                </CardContent>
              </Card>

              {sessions.length === 0 ? (
                <EmptyState icon={CalendarDays} title="No plan yet" description="Add exam dates, then generate a schedule grounded in syllabus priority and mastery gaps." action={<Button onClick={generate} loading={generating}>Generate study plan</Button>} />
              ) : (
                <div className="space-y-3">
                  {grouped.map(([day, daySessions]) => (
                    <div key={day} className="glass-panel p-3.5">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold">{dayLabel(day)}</p>
                        <span className="text-[10px] text-muted-foreground">{daySessions.reduce((sum, item) => sum + item.duration_minutes, 0)} min</span>
                      </div>
                      <div className="space-y-1.5">
                        {daySessions.map((session) => (
                          <div key={session.id} className={cn("flex items-center gap-3 rounded-lg border p-2.5", session.status === "completed" ? "border-success/20 bg-success/[0.03]" : "border-border/60 bg-background/25")}>
                            <span className="w-12 shrink-0 text-[11px] font-medium text-muted-foreground">{session.start_time}</span>
                            <div className="h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary to-accent" />
                            <div className="min-w-0 flex-1">
                              <p className={cn("truncate text-xs font-medium", session.status === "completed" && "line-through opacity-60")}>{session.topic_title || session.subject_name || "General study"}</p>
                              <p className="truncate text-[10px] text-muted-foreground">{session.duration_minutes} min · {session.kind} · {session.rationale}</p>
                            </div>
                            <Badge className="hidden sm:inline-flex">{session.status}</Badge>
                            {session.status === "planned" ? (
                              <>
                                <Button variant="ghost" size="icon-sm" onClick={() => setStatus(session, "completed")} aria-label="Mark completed"><CheckCircle2 size={15} className="text-success" /></Button>
                                <Button variant="ghost" size="icon-sm" onClick={() => setStatus(session, "skipped")} aria-label="Skip session"><Square size={13} className="text-muted-foreground" /></Button>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-4">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ListOrdered size={15} className="text-primary" /> Priority queue</CardTitle></CardHeader>
                <CardContent>
                  {ranked.length === 0 ? <p className="text-xs text-muted-foreground">Add syllabus topics to rank them.</p> : (
                    <div className="space-y-2">
                      {ranked.slice(0, 10).map((topic, index) => (
                        <button key={topic.id} onClick={() => navigate(`/learn/${topic.id}`)} className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-muted/[0.15] p-2 text-left transition hover:border-primary/30">
                          <span className="w-4 text-center text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium">{topic.title}</span>
                            <span className="block truncate text-[9px] text-muted-foreground">{topic.subject} · {Math.round(topic.mastery)}% mastery</span>
                          </span>
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase", priorityStyle[topic.priority])}>{topic.priority}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )
      ) : null}

      {tab === "exams" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>Upcoming examinations</CardTitle><Button size="sm" variant="outline" onClick={() => setExamOpen(true)}><Plus size={13} /> Add</Button></CardHeader>
            <CardContent>
              {exams.length === 0 ? <EmptyState icon={Target} title="No exams scheduled" description="Add exam dates so the planner and readiness score can adapt." action={<Button onClick={() => setExamOpen(true)}>Add exam</Button>} /> : (
                <div className="space-y-2">
                  {exams.map((exam) => (
                    <div key={exam.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/[0.15] p-3">
                      <div className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border text-[9px] font-semibold uppercase", exam.days_left <= 7 ? "border-danger/30 bg-danger/[0.08] text-danger" : "border-primary/25 bg-primary/[0.08] text-primary")}>
                        <Flame size={13} /><span>{exam.days_left}d</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{exam.title}</p>
                        <p className="text-[10px] text-muted-foreground">{exam.subject_name} · {formatDate(exam.exam_date)} · weight {exam.weight}%</p>
                        {exam.notes ? <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{exam.notes}</p> : null}
                      </div>
                      <Button variant="ghost" size="icon-sm" onClick={() => removeExam(exam.id)} aria-label="Delete exam"><Trash2 size={13} className="text-danger" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ListOrdered size={15} className="text-primary" /> What to study next</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ranked.slice(0, 8).map((topic) => (
                <div key={topic.id} className="rounded-lg border border-border/50 bg-muted/[0.15] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={() => navigate(`/learn/${topic.id}`)} className="truncate text-[11px] font-medium hover:text-primary">{topic.title}</button>
                    <span className="text-[9px] text-muted-foreground">{topic.exam_date ? formatDate(topic.exam_date) : "no exam"}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2"><Progress value={topic.mastery} className="h-1 flex-1" /><span className="text-[9px] text-muted-foreground">{Math.round(topic.mastery)}%</span></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "focus" ? <FocusTimer subjects={subjects} exams={exams} /> : null}

      <Dialog open={examOpen} onClose={() => setExamOpen(false)} title="Add examination" description="Exam dates drive planner urgency and readiness estimates." size="md">
        <div className="space-y-3">
          <div><label className="label">Subject</label><Select value={examForm.subject_id} onChange={(event) => setExamForm({ ...examForm, subject_id: Number(event.target.value) })}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select></div>
          <div><label className="label">Exam title</label><Input value={examForm.title} onChange={(event) => setExamForm({ ...examForm, title: event.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Date</label><Input type="date" value={examForm.exam_date} onChange={(event) => setExamForm({ ...examForm, exam_date: event.target.value })} /></div>
            <div><label className="label">Weight (%)</label><Input type="number" min={0} max={100} value={examForm.weight} onChange={(event) => setExamForm({ ...examForm, weight: Number(event.target.value) })} /></div>
          </div>
          <div><label className="label">Notes</label><Textarea rows={3} value={examForm.notes} onChange={(event) => setExamForm({ ...examForm, notes: event.target.value })} placeholder="Modules covered, hall, seating…" /></div>
          <Button className="w-full" onClick={createExam} loading={savingExam}>Add exam</Button>
        </div>
      </Dialog>
    </div>
  );
}

function FocusTimer({ subjects, exams }: { subjects: { id: number; name: string }[]; exams: Exam[] }) {
  const { toast } = useToast();
  const [subjectId, setSubjectId] = useState<number | "">(subjects[0]?.id ?? "");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [kind, setKind] = useState("focus");
  const [preset, setPreset] = useState(25);
  const [duration, setDuration] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    if (subjectId === "") { setTopics([]); return; }
    api.topics(Number(subjectId)).then(setTopics).catch(() => setTopics([]));
    setTopicId("");
  }, [subjectId]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const total = duration;
  const elapsedMinutes = Math.max(1, Math.round(((total - remaining) / 60) * 10) / 10);

  const changePreset = (minutes: number) => {
    setPreset(minutes);
    setDuration(minutes * 60);
    setRemaining(minutes * 60);
    setRunning(false);
    setStartedAt(null);
    savedRef.current = false;
  };

  const start = () => {
    if (remaining <= 0) return;
    savedRef.current = false;
    if (!startedAt) setStartedAt(Date.now());
    setRunning(true);
  };

  const finish = async (auto = false) => {
    setRunning(false);
    if (savedRef.current) return;
    const seconds = total - remaining;
    const minutes = Math.max(1, Math.round((seconds / 60) * 10) / 10);
    savedRef.current = true;
    try {
      await api.logStudy({ minutes, subject_id: subjectId === "" ? undefined : Number(subjectId), topic_id: topicId === "" ? undefined : Number(topicId), kind, notes: auto ? "Focus timer completed" : "Focus timer stopped early" });
      toast(auto ? "Focus session complete" : "Study time logged", `${minutes} minutes recorded.`, "success");
      setStartedAt(null);
      setRemaining(total);
    } catch (error) {
      savedRef.current = false;
      toast("Could not log study session", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  useEffect(() => {
    if (remaining === 0 && startedAt && !savedRef.current) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const progress = total ? ((total - remaining) / total) * 100 : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Focus timer</CardTitle><p className="text-xs text-muted-foreground">Log uninterrupted study blocks. Completed sessions feed your streak and weekly hours.</p></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center gap-2">
            {[25, 50, 90].map((value) => (
              <button key={value} onClick={() => changePreset(value)} className={cn("rounded-lg border px-4 py-2 text-xs transition", preset === value ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/25")}>{value} min</button>
            ))}
          </div>
          <div className="flex flex-col items-center py-4">
            <div className="relative flex h-52 w-52 items-center justify-center">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="88" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
                <circle cx="100" cy="100" r="88" fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeLinecap="round" strokeDasharray={2 * Math.PI * 88} strokeDashoffset={2 * Math.PI * 88 * (1 - progress / 100)} style={{ transition: "stroke-dashoffset 1s linear" }} />
              </svg>
              <div className="text-center">
                <p className="font-mono text-5xl font-semibold tabular-nums">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{running ? kind : preset === 25 ? "Pomodoro" : "Deep work"}</p>
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-2">
            {running ? <Button variant="outline" onClick={() => setRunning(false)}><Pause size={15} /> Pause</Button> : <Button onClick={start} disabled={remaining === 0}><Play size={15} /> {startedAt ? "Resume" : "Start"}</Button>}
            <Button variant="outline" onClick={() => finish(false)} disabled={!startedAt || remaining === total}><Square size={13} /> End & log</Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground">{startedAt ? `${elapsedMinutes} minutes elapsed` : "Select a subject below before starting."}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Session context</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><label className="label">Subject</label><Select value={subjectId} onChange={(event) => setSubjectId(event.target.value === "" ? "" : Number(event.target.value))}><option value="">General</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</Select></div>
          <div><label className="label">Topic (optional)</label><Select value={topicId} onChange={(event) => setTopicId(event.target.value === "" ? "" : Number(event.target.value))}><option value="">Not specific</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</Select></div>
          <div><label className="label">Activity</label><Select value={kind} onChange={(event) => setKind(event.target.value)}>{kinds.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</Select></div>
          {exams.length > 0 ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Exam pressure</p>
              {exams.slice(0, 3).map((exam) => <p key={exam.id} className="mt-1 text-[11px] text-muted-foreground">{exam.subject_name} · {formatDate(exam.exam_date)} ({exam.days_left}d)</p>)}
            </div>
          ) : null}
          <p className="text-[10px] leading-4 text-muted-foreground">Tip: end a session early and it still logs the elapsed time. Completing planned sessions in the Study plan tab also records time automatically.</p>
        </CardContent>
      </Card>
    </div>
  );
}
