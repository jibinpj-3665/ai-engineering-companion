import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function PageLoader({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-2xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] opacity-25 blur-xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
