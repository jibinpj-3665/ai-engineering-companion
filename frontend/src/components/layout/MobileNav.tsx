import { NavLink } from "react-router-dom";
import { BookMarked, Files, LayoutDashboard, MessagesSquare, PencilRuler, Settings } from "lucide-react";
import { cn } from "../../lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/syllabus-library", label: "Syllabus", icon: BookMarked },
  { to: "/documents", label: "Library", icon: Files },
  { to: "/tutor", label: "Tutor", icon: MessagesSquare, primary: true },
  { to: "/practice", label: "Practice", icon: PencilRuler },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-2xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary navigation"
    >
      <div className="mx-auto flex max-w-md items-end justify-around px-2 pb-1 pt-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                "focus-ring flex min-w-[56px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[9px] font-medium transition",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {({ isActive }) => (
                <>
                  <span className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition",
                    item.primary && "bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] text-white shadow-[0_8px_24px_-10px_hsl(var(--accent))]",
                    isActive && !item.primary && "bg-primary/10",
                  )}>
                    <Icon size={item.primary ? 18 : 17} />
                  </span>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
