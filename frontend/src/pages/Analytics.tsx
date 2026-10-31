import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BarChart3, Brain, Clock, Flame, GraduationCap, Target, TrendingUp } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { AnalyticsData } from "../lib/types";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { EmptyState } from "../components/ui/EmptyState";
import { PageLoader } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";
import { cn, dayLabel, formatDateTime, formatMinutes, priorityStyle } from "../lib/utils";

function MinutesTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-panel">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{formatMinutes(payload[0]?.value || 0)} studied</p>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.analytics().then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load analytics"));
  }, []);

  if (error) return <EmptyState icon={BarChart3} title="Analytics unavailable" description={error} action={<Button onClick={() => window.location.reload()}>Retry</Button>} />;
  if (!data) return <PageLoader label="Crunching your learning data" />;

  const readinessTone = data.exam_readiness >= 75 ? "text-success" : data.exam_readiness >= 45 ? "text-warning" : "text-danger";

  return (
    <div className="space-y-5">
      <PageHeader title="Learning Analytics" subtitle="Honest feedback on study time, mastery, retention and exam readiness." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="This week" value={formatMinutes(data.hours_week * 60)} hint={`${formatMinutes(data.hours_today * 60)} today`} icon={Clock} />
        <StatCard label="Study streak" value={`${data.streak_days} days`} hint="Consecutive active days" icon={Flame} accent="warning" />
        <StatCard label="Quiz average" value={`${Math.round(data.quiz_average)}%`} hint={`${data.quiz_attempts} attempts`} icon={TrendingUp} accent={data.quiz_average >= 70 ? "success" : "warning"} />
        <StatCard label="Mastered topics" value={`${data.mastered_topics}/${data.total_topics}`} hint={`${data.mastered_high} high-priority`} icon={GraduationCap} accent="primary" />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader className="flex-row items-start justify-between">
            <div><CardTitle>Study time</CardTitle><p className="mt-1 text-xs text-muted-foreground">Minutes per day over the last 14 days.</p></div>
            <Badge><Activity size={10} /> {formatMinutes(data.hours_week * 60)} this week</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MinutesTooltip />} cursor={{ stroke: "hsl(var(--primary))", strokeDasharray: "4 4" }} />
                  <Area type="monotone" dataKey="minutes" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#analyticsFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader><CardTitle className="flex items-center gap-2"><Target size={15} className="text-primary" /> Exam readiness</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col items-center py-3">
              <div className="relative flex h-36 w-36 items-center justify-center">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="68" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                  <circle cx="80" cy="80" r="68" fill="none" stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round" strokeDasharray={2 * Math.PI * 68} strokeDashoffset={2 * Math.PI * 68 * (1 - Math.min(100, Math.max(0, data.exam_readiness)) / 100)} />
                </svg>
                <div className="text-center"><p className={cn("font-display text-3xl font-semibold", readinessTone)}>{Math.round(data.exam_readiness)}%</p><p className="text-[9px] uppercase tracking-wider text-muted-foreground">ready</p></div>
              </div>
              <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">{data.readiness_note}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader><CardTitle>Subject progress</CardTitle></CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.subjects} layout="vertical" margin={{ top: 2, right: 20, left: 4, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="code" width={48} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const entry = payload[0].payload as AnalyticsData["subjects"][number];
                    return <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-panel"><p className="font-medium">{entry.name}</p><p className="text-muted-foreground">{Math.round(entry.completion)}% complete · avg mastery {Math.round(entry.average_mastery)}%</p></div>;
                  }} />
                  <Bar dataKey="completion" radius={[0, 6, 6, 0]} barSize={14}>
                    {data.subjects.map((subject) => <Cell key={subject.id} fill={subject.color || "hsl(var(--primary))"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-7">
          <CardHeader><CardTitle>Focus next</CardTitle></CardHeader>
          <CardContent>
            {data.weak_topics.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No weak topics detected yet. Parse a syllabus and take a quiz to surface gaps.</p>
            ) : (
              <div className="space-y-2">
                {data.weak_topics.slice(0, 6).map((topic) => (
                  <Link key={topic.id} to={`/learn/${topic.id}`} className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/[0.15] p-2.5 transition hover:border-primary/30">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate text-[11px] font-medium">{topic.title}</span><span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase", priorityStyle[topic.priority])}>{topic.priority}</span></span>
                      <span className="mt-1.5 flex items-center gap-2"><Progress value={topic.mastery} className="h-1 flex-1" /><span className="text-[9px] text-muted-foreground">{Math.round(topic.mastery)}%</span></span>
                    </span>
                    <Brain size={14} className="shrink-0 text-primary" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Retention snapshot</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Due today", value: data.revision.due_today },
                { label: "Overdue", value: data.revision.overdue },
                { label: "Cards", value: data.revision.total },
                { label: "Retention", value: `${Math.round(data.revision.retention)}%` },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-border/60 bg-muted/[0.15] p-3 text-center">
                  <p className="font-display text-xl font-semibold">{item.value}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-4 text-muted-foreground">Retention is estimated from review history and scheduling ease. Overdue cards drag readiness down.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent assessments</CardTitle></CardHeader>
          <CardContent>
            {data.recent_attempts.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No quiz attempts yet.</p> : (
              <div className="space-y-1.5">
                {data.recent_attempts.slice(0, 5).map((attempt) => (
                  <div key={attempt.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/[0.15] px-3 py-2">
                    <div><p className="text-[11px] font-medium">Attempt #{attempt.id}</p><p className="text-[9px] text-muted-foreground">{formatDateTime(attempt.completed_at)}</p></div>
                    <div className="flex items-center gap-3"><span className="text-[10px] text-muted-foreground">{attempt.score}/{attempt.max_score}</span><span className={cn("text-xs font-semibold", attempt.percent >= 70 ? "text-success" : attempt.percent >= 40 ? "text-warning" : "text-danger")}>{Math.round(attempt.percent)}%</span></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
