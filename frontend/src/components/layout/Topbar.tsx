import { Link, useNavigate } from "react-router-dom";
import { Bell, Command, Menu, Moon, Search, Settings2, Sun, WifiOff, Zap } from "lucide-react";
import { api } from "../../lib/api";
import { cn, initials } from "../../lib/utils";
import { useApp } from "../../contexts/AppContext";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export function Topbar({
  onOpenSearch,
  onOpenNotifications,
  onOpenMobile,
}: {
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenMobile: () => void;
}) {
  const { settings, setSettings, notifications, aiStatus } = useApp();
  const navigate = useNavigate();
  const { toast } = useToast();
  const unread = notifications.filter((item) => !item.read).length;
  const isDark = settings?.theme !== "light";

  const toggleTheme = async () => {
    if (!settings) return;
    const nextTheme = isDark ? "light" : "dark";
    setSettings({ ...settings, theme: nextTheme });
    try {
      const updated = await api.updateSettings({ theme: nextTheme });
      setSettings(updated);
    } catch {
      toast("Could not save theme", "Your choice applies for this session only.", "warning");
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobile} aria-label="Open navigation">
          <Menu size={19} />
        </Button>

        <button
          onClick={onOpenSearch}
          className="focus-ring group flex h-[38px] w-full max-w-md items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 text-left text-sm text-muted-foreground transition hover:border-primary/30 hover:bg-muted/60"
          style={{ height: 38 }}
        >
          <Search size={15} className="shrink-0 text-muted-foreground group-hover:text-primary" />
          <span className="flex-1 truncate">Search subjects, topics, notes…</span>
          <span className="hidden items-center gap-1 sm:flex">
            <span className="kbd"><Command size={9} /></span>
            <span className="kbd">K</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Link
            to="/settings"
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition sm:flex",
              aiStatus?.configured
                ? "border-success/25 bg-success/[0.08] text-success hover:bg-success/[0.15]"
                : "border-warning/25 bg-warning/[0.08] text-warning hover:bg-warning/[0.15]",
            )}
            title={aiStatus?.message}
          >
            {aiStatus?.configured ? <Zap size={11} /> : <WifiOff size={11} />}
            {aiStatus?.configured ? "AI ready" : "Offline mode"}
          </Link>

          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </Button>

          <button
            onClick={onOpenNotifications}
            className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Open notifications"
          >
            <Bell size={17} />
            {unread > 0 ? (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => navigate("/settings")}
            className="focus-ring ml-1 flex items-center gap-2 rounded-xl border border-transparent p-0.5 pr-2 transition hover:border-border hover:bg-muted/50"
            aria-label="Profile settings"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] text-[11px] font-bold text-white">
              {initials(settings?.student_name || "Engineer")}
            </span>
            <span className="hidden text-left md:block">
              <span className="block max-w-28 truncate text-xs font-semibold leading-4">{settings?.student_name || "Engineer"}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Settings2 size={9} /> Settings</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
