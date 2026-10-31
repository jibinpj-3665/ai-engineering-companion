import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/30 px-6 py-12 text-center", className)}>
      <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/[0.08] p-3.5 text-primary">
        <Icon size={24} />
      </div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
