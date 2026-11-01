import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  GraduationCap,
  Layers,
  ListChecks,
  Play,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { DashboardData } from "../lib/types";
import { useToast } from "../components/ui/Toast";
import { PageLoader } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { StatCard } from "../components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { cn, dayLabel, formatDate, formatMinutes, priorityStyle } from "../lib/utils";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-panel">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatMinutes(payload[0]?.value || 0)} studied</p>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.dashboard()
      .then(setData)
      .catch((error) => setFailed(error instanceof ApiError ? error.message : "Could not load dashboard"));
  }, []);

  if (failed) {
    return <EmptyState icon={Brain} title="Dashboard unavailable" description={failed} action={<Button onClick={() => window.location.reload()}>Retry</Button>} />;
  }
  if (!data) return <PageLoader label="Reading your learning records" />;

  const startLearning = () => {
    if (data.mission?.topic_id) navigate(`/learn/${data.mission.topic_id}`);
    else if (data.continue_topic) navigate(`/learn/${data.continue_topic.id}`);
    else navigate("/subjects");
  };

  const goalPercent = Math.min(100, Math.round((data.today_minutes / Math.max(1, data.daily_goal_minutes)) * 100));
  const maxMinutes = Math.max(60, ...data.daily.map((point) => point.minutes));

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/60 p-6 shadow-panel backdrop-blur-xl sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-1/3 h-56 w-56 rounded-full bg-[hsl(var(--accent-2))]/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Badge className="mb-4 border-primary/25 bg-primary/[0.08] text-primary">
              <Sparkles size={11} /> {data.greeting}, {data.student_name}
            </Badge>
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[2.15rem]">
              Learn engineering. <span className="gradient-text">Think deeper.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              {data.has_data
                ? data.mission
                  ? `Your study buddy suggests: ${data.mission.title}. ${data.mission.detail}`
                  : "Your workspace is ready. Add syllabus topics to generate a personalised mission."
                : "Build your learning workspace: create a subject, upload your notes, then parse a syllabus. Everything stays on this device."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="gradient" size="lg" onClick={startLearning}>
                <Play size={17} /> START LEARNING
              </Button>
              {!data.has_data ? (
                <Button variant="outline" size="lg" onClick={() => navigate("/subjects")}>
                  <Plus size={16} /> Create first subject
                </Button>
              ) : (
                <Button variant="outline" size="lg" onClick={() => navigate("/tutor")}>
                  <Sparkles size={16} /> Ask study buddy
                </Button>
              )}
            </div>
          </div>

          <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-background/40 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-primary/25 bg-primary/10 p-1.5 text-primary"><Target size={15} /></div>
                <div>
                  <p className="text-xs font-semibold">Today's focus</p>
                  <p className="text-[10px] text-muted-foreground">Daily goal {formatMinutes(data.daily_goal_minutes)}</p>
                </div>
              </div>
              <span className="font-display text-lg font-semibold">{goalPercent}%</span>
            </div>
            <Progress value={goalPercent} className="mt-3 h-2" />
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{formatMinutes(data.today_minutes)} logged</span>
              <span>{formatMinutes(Math.max(0, data.daily_goal_minutes - data.today_minutes))} remaining</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
              <div>
                <p className="font-display text-base font-semibold">{data.stats.streak_days}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">day streak</p>
              </div>
              <div>
                <p className="font-display text-base font-semibold">{data.stats.due_flashcards}</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">due cards</p>
              </div>
              <div>
                <p className="font-display text-base font-semibold">{data.stats.exam_readiness}%</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">readiness</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Study streak" value={`${data.stats.streak_days} day${data.stats.streak_days === 1 ? "" : "s"}`} hint="Consecutive study days" icon={Flame} accent="warning" />
        <StatCard label="This week" value={`${data.stats.hours_week}h`} hint={`${formatMinutes(data.today_minutes)} today`} icon={Clock} accent="primary" />
        <StatCard label="Topics mastered" value={data.stats.mastered_topics} hint={`${data.stats.topics_mastered_high} at 85%+`} icon={Trophy} accent="success" />
        <StatCard label="Quiz average" value={`${data.stats.quiz_average}%`} hint="Across all evaluated attempts" icon={TrendingUp} accent="muted" />
      </div>

      {!data.has_data ? (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ListChecks size={17} className="text-primary" /> Set up your workspace</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {[
              { step: "01", title: "Create a subject", detail: "Add a semester subject and its code.", to: "/subjects", done: false, icon: BookOpen },
              { step: "02", title: "Upload study material", detail: "PDF, DOCX, PPTX, TXT or scanned notes.", to: "/documents", done: false, icon: Layers },
              { step: "03", title: "Analyse the syllabus", detail: "Extract modules, topics and priorities.", to: "/syllabus", done: false, icon: ListChecks },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.step} to={item.to} className="group rounded-xl border border-border bg-muted/25 p-4 transition hover:border-primary/[0.35] hover:bg-primary/5">
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary"><Icon size={16} /></span>
                    <span className="font-mono text-[10px] text-muted-foreground">{item.step}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary opacity-80 group-hover:opacity-100">Open <ArrowRight size={11} /></span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {data.mission ? (
            <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(120deg,hsl(var(--accent)/0.1),transparent_55%)]">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] text-white shadow-glow">
                  <Target size={21} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Today's mission</p>
                  <p className="mt-1 truncate font-display text-lg font-semibold">{data.mission.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{data.mission.detail}</p>
                </div>
                <Button onClick={() => (data.mission?.action === "revision" ? navigate("/revision") : startLearning())}>
                  {data.mission.action === "revision" ? "Start revision" : "Continue"} <ArrowRight size={15} />
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Weekly learning pulse</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Time logged from focus sessions, quizzes and planned study.</p>
              </div>
              <Badge><Clock size={11} /> {data.stats.hours_week}h this week</Badge>
            </CardHeader>
            <CardContent>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pulse" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 6" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, maxMinutes]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="minutes" stroke="hsl(var(--accent))" strokeWidth={2.5} fill="url(#pulse)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {data.semesters?.length ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><GraduationCap size={16} className="text-primary" /> Semester progress</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Imported syllabus structure and your weighted completion.</p>
                </div>
                <Link to="/syllabus-library" className="text-xs text-primary hover:underline">Syllabus library</Link>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {data.semesters.map((semester) => (
                  <button key={`${semester.semester}-${semester.academic_year}`} onClick={() => navigate("/syllabus-library")} className="w-full rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition hover:border-primary/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{semester.semester}</p>
                        {semester.academic_year ? <Badge>{semester.academic_year}</Badge> : null}
                      </div>
                      <span className="text-xs font-medium">{semester.completion}%</span>
                    </div>
                    <Progress value={semester.completion} className="mt-2" />
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{semester.subjects} subjects · {semester.modules} modules · {semester.topics} topics · {semester.mastered} mastered{semester.credits ? ` · ${semester.credits} credits` : ""}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Subject progress</CardTitle>
              <Link to="/subjects" className="text-xs text-primary hover:underline">Manage subjects</Link>
            </CardHeader>
            <CardContent>
              {data.subjects.length === 0 ? (
                <EmptyState icon={BookOpen} title="No subjects yet" description="Create a subject to begin organising notes and syllabus." action={<Button size="sm" onClick={() => navigate("/subjects")}><Plus size={14} /> Create subject</Button>} className="py-8" />
              ) : (
                <div className="space-y-3.5">
                  {data.subjects.slice(0, 6).map((subject) => (
                    <button
                      key={subject.id}
                      onClick={() => navigate(`/documents?subject=${subject.id}`)}
                      className="group flex w-full items-center gap-4 rounded-xl border border-transparent px-2 py-2 text-left transition hover:border-border hover:bg-muted/[0.35]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                        {(subject.code || subject.name).slice(0, 3).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium">{subject.name}</p>
                          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(subject.completion)}%</span>
                        </div>
                        <Progress value={subject.completion} className="mt-2" />
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          {subject.mastered} mastered · {subject.topics} topics · {subject.documents} documents
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><CalendarDays size={16} className="text-primary" /> Today's plan</CardTitle>
              <Link to="/planner" className="text-xs text-primary hover:underline">Planner</Link>
            </CardHeader>
            <CardContent>
              {data.today_plan.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground">No sessions scheduled today.</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate("/planner")}>Generate a plan</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.today_plan.slice(0, 4).map((session) => (
                    <div key={session.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/25 p-2.5">
                      <div className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{session.start_time}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{session.rationale.split(" — ")[0]}</p>
                        <p className="text-[10px] text-muted-foreground">{session.duration_minutes} min · {session.kind.replace("_", " ")}</p>
                      </div>
                      <Badge className={cn("shrink-0", session.status === "completed" ? "border-success/30 text-success" : "")}>{session.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><GraduationCap size={16} className="text-primary" /> Upcoming exams</CardTitle>
              <Link to="/planner" className="text-xs text-primary hover:underline">Add</Link>
            </CardHeader>
            <CardContent>
              {data.upcoming_exams.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No exams scheduled. Add exam dates to build urgency into your plan.</p>
              ) : (
                <div className="space-y-2">
                  {data.upcoming_exams.map((exam) => (
                    <div key={exam.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/25 p-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{exam.title}</p>
                        <p className="text-[10px] text-muted-foreground">{exam.subject} · {formatDate(exam.date)}</p>
                      </div>
                      <Badge className={exam.days_left <= 7 ? "border-danger/30 bg-danger/10 text-danger" : exam.days_left <= 21 ? "border-warning/30 bg-warning/10 text-warning" : ""}>
                        {exam.days_left} d
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Layers size={16} className="text-primary" /> Revision</CardTitle>
              <Link to="/revision" className="text-xs text-primary hover:underline">Review</Link>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="font-display text-xl font-semibold">{data.revision.due_today}</p>
                  <p className="text-[10px] text-muted-foreground">Due today</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                  <p className="font-display text-xl font-semibold">{data.revision.retention}%</p>
                  <p className="text-[10px] text-muted-foreground">Retention</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate("/revision")}>
                Review {data.revision.due_today} card{data.revision.due_today === 1 ? "" : "s"} <ArrowRight size={13} />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Brain size={16} className="text-warning" /> Weak topics</CardTitle>
            <Link to="/analytics" className="text-xs text-primary hover:underline">Analytics</Link>
          </CardHeader>
          <CardContent>
            {data.weak_topics.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 p-3 text-xs text-success">
                <CheckCircle2 size={15} /> No weak topics detected yet. Parse a syllabus and take quizzes to build mastery data.
              </div>
            ) : (
              <div className="space-y-2">
                {data.weak_topics.slice(0, 4).map((topic) => (
                  <button key={topic.id} onClick={() => navigate(`/learn/${topic.id}`)} className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/25 p-2.5 text-left transition hover:border-primary/30">
                    <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase", priorityStyle[topic.priority])}>{topic.priority}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{topic.title}</span>
                    <span className="text-[10px] text-muted-foreground">{topic.mastery}%</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles size={16} className="text-primary" /> Recommended next lesson</CardTitle>
          </CardHeader>
          <CardContent>
            {data.continue_topic ? (
              <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.15] text-primary"><GraduationCap size={20} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{data.continue_topic.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {data.continue_topic.subject} · {data.continue_topic.module} · {data.continue_topic.mastery}% mastery
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge className={cn("px-1.5 py-0 text-[9px]", priorityStyle[data.continue_topic.priority])}>{data.continue_topic.priority}</Badge>
                    <span className="text-[10px] text-muted-foreground">{dayLabel(new Date().toISOString().slice(0, 10))} · recommended</span>
                  </div>
                </div>
                <Button size="sm" onClick={() => navigate(`/learn/${data.continue_topic?.id}`)}>Continue <ArrowRight size={13} /></Button>
              </div>
            ) : (
              <EmptyState icon={GraduationCap} title="No topic in progress" description="Parse a syllabus to get a recommended lesson." action={<Button size="sm" onClick={() => navigate("/syllabus")}>Open syllabus</Button>} className="py-6" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
