import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  Files,
  FlaskConical,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListTree,
  MessagesSquare,
  PencilRuler,
  Settings,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { useApp } from "../../contexts/AppContext";

const groups = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/subjects", label: "Subjects", icon: BookOpen },
      { to: "/documents", label: "Knowledge Base", icon: Files },
      { to: "/syllabus", label: "Syllabus", icon: ListTree },
    ],
  },
  {
    label: "Learn",
    items: [
      { to: "/tutor", label: "AI Tutor", icon: MessagesSquare },
      { to: "/learn", label: "Step Teaching", icon: GraduationCap },
      { to: "/practice", label: "Practice", icon: PencilRuler },
      { to: "/labs", label: "Engineering Lab", icon: FlaskConical },
      { to: "/visuals", label: "Visual Lab", icon: Activity },
    ],
  },
  {
    label: "Progress",
    items: [
      { to: "/revision", label: "Revision", icon: Layers },
      { to: "/planner", label: "Study Planner", icon: CalendarClock },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
];

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const navigate = useNavigate();
  const { settings } = useApp();

  const body = (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center gap-3 px-4 pb-5 pt-5", collapsed && "justify-center px-2")}>
        <button
          onClick={() => {
            navigate("/");
            onMobileClose();
          }}
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] shadow-glow"
          aria-label="AI Engineering Companion home"
        >
          <Sparkles size={19} className="text-white" />
          <span className="absolute inset-0 rounded-xl opacity-0 ring-2 ring-white/30 transition group-hover:opacity-100" />
        </button>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate font-display text-[0.9rem] font-semibold leading-tight">AI Engineering</p>
            <p className="truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Companion</p>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            {!collapsed ? <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">{group.label}</p> : <div className="mx-auto mb-2 h-px w-6 bg-border" />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onMobileClose}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) => cn("nav-item", isActive && "nav-item-active", collapsed && "justify-center px-0")}
                  >
                    <Icon size={17} className="shrink-0" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-border/70 px-3 py-3">
        <NavLink to="/settings" onClick={onMobileClose} className={({ isActive }) => cn("nav-item", isActive && "nav-item-active", collapsed && "justify-center px-0")}>
          <Settings size={17} className="shrink-0" />
          {!collapsed ? <span>Settings</span> : null}
        </NavLink>
        {!collapsed ? (
          <div className="mt-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
            <p className="truncate text-xs font-medium">{settings?.student_name || "Engineer"}</p>
            <p className="text-[10px] text-muted-foreground">Local workspace · v1.0.0</p>
          </div>
        ) : null}
        <button
          onClick={onToggle}
          className="nav-item hidden w-full justify-center px-0 lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft size={16} className={cn("transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "relative z-30 hidden h-screen shrink-0 border-r border-border/70 bg-panel/70 backdrop-blur-2xl transition-[width] duration-300 lg:block",
          collapsed ? "w-[76px]" : "w-[248px]",
        )}
      >
        {body}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onMobileClose} />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="relative h-full w-[264px] border-r border-border bg-background/95 backdrop-blur-2xl"
          >
            {body}
          </motion.aside>
        </div>
      ) : null}
    </>
  );
}
