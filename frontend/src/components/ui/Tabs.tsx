import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card/60 p-1", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
              active ? "bg-primary/[0.15] text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {Icon ? <Icon size={14} /> : null}
            {item.label}
            {typeof item.count === "number" ? (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
