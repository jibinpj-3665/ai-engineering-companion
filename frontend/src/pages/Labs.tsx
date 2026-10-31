import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Beaker, Clock, FlaskConical, Layers3, Search, Wrench } from "lucide-react";
import { api } from "../lib/api";
import type { LabSummary } from "../lib/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { PageLoader } from "../components/ui/Spinner";
import { cn } from "../lib/utils";

const difficultyStyle: Record<string, string> = {
  beginner: "border-success/25 bg-success/[0.08] text-success",
  intermediate: "border-warning/25 bg-warning/[0.08] text-warning",
  advanced: "border-danger/25 bg-danger/[0.08] text-danger",
};

export default function Labs() {
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("All");

  useEffect(() => {
    api.labs().then(setLabs).catch(() => setLabs([])).finally(() => setLoading(false));
  }, []);

  const domains = useMemo(() => ["All", ...Array.from(new Set(labs.map((lab) => lab.domain)))], [labs]);
  const filtered = labs.filter((lab) => {
    const matchesDomain = domain === "All" || lab.domain === domain;
    const text = `${lab.title} ${lab.domain} ${lab.tools.join(" ")}`.toLowerCase();
    return matchesDomain && text.includes(query.toLowerCase());
  });

  if (loading) return <PageLoader label="Opening virtual lab bench" />;

  return (
    <div>
      <PageHeader
        title="Virtual Engineering Labs"
        subtitle="Eight guided experiments with theory, algorithms, runnable code, simulated results and viva questions."
        actions={<Badge><FlaskConical size={11} /> Simulation-only labs</Badge>}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search labs, domains or tools…" className="focus-ring h-10 w-full rounded-xl border border-border bg-muted/[0.35] pl-9 pr-3 text-sm" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map((item) => (
            <button key={item} onClick={() => setDomain(item)} className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition", domain === item ? "border-primary/[0.45] bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/25")}>{item}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Beaker} title="No labs match" description="Try another domain or search term." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((lab) => (
            <Link key={lab.slug} to={`/labs/${lab.slug}`} className="group glass-panel flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-primary/[0.35]">
              <div className="flex items-start justify-between gap-2">
                <div className="rounded-xl border border-primary/20 bg-primary/[0.08] p-2 text-primary"><Beaker size={18} /></div>
                <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", difficultyStyle[lab.difficulty] || "border-border text-muted-foreground")}>{lab.difficulty}</span>
              </div>
              <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-primary">{lab.domain}</p>
              <h3 className="mt-1 font-display text-sm font-semibold leading-5">{lab.title}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lab.tools.slice(0, 3).map((tool) => <Badge key={tool}>{tool}</Badge>)}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-3"><span className="flex items-center gap-1"><Clock size={11} /> {lab.duration_minutes} min</span><span className="flex items-center gap-1"><Wrench size={11} /> {lab.language}</span></span>
                <span className="flex items-center gap-1 text-primary opacity-0 transition group-hover:opacity-100">Open <ArrowRight size={11} /></span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[10px] leading-5 text-muted-foreground">
        <Layers3 size={13} className="mt-0.5 shrink-0 text-primary" />
        Experiments are interactive simulations and educational code. They are not reported as hardware-verified. Run the code locally or in LTspice (where provided) and record your own observations.
      </div>
    </div>
  );
}
