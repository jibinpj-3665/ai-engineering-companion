import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "primary",
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "danger" | "muted";
  footer?: ReactNode;
  className?: string;
}) {
  const styles = {
    primary: "border-primary/20 bg-primary/[0.08] text-primary",
    success: "border-success/20 bg-success/[0.08] text-success",
    warning: "border-warning/20 bg-warning/[0.08] text-warning",
    danger: "border-danger/20 bg-danger/[0.08] text-danger",
    muted: "border-border bg-muted text-muted-foreground",
  };
  return (
    <div className={cn("glass-panel group relative overflow-hidden p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30", className)}>
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl transition group-hover:bg-primary/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>
          {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className={cn("rounded-xl border p-2", styles[accent])}>
            <Icon size={17} />
          </div>
        ) : null}
      </div>
      {footer ? <div className="relative mt-3">{footer}</div> : null}
    </div>
  );
}
