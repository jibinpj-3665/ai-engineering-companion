import { AnimatePresence, motion } from "framer-motion";
import { BellOff, CheckCheck, CheckCircle2, Info, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import type { Notification } from "../../lib/types";
import { cn, timeAgo } from "../../lib/utils";
import { useApp } from "../../contexts/AppContext";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/Button";

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, refreshNotifications } = useApp();
  const { toast } = useToast();

  const markRead = async (item: Notification) => {
    if (!item.read) await api.readNotification(item.id);
    await refreshNotifications();
  };

  const markAll = async () => {
    await api.readAllNotifications();
    await refreshNotifications();
    toast("Notifications cleared", "All items marked as read.", "success");
  };

  const remove = async (id: number) => {
    await api.deleteNotification(id);
    await refreshNotifications();
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70]">
          <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-border bg-background/95 backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold">Notifications</h2>
                <p className="text-xs text-muted-foreground">{notifications.filter((item) => !item.read).length} unread</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={markAll}><CheckCheck size={14} /> Mark all</Button>
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close notifications"><X size={16} /></Button>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {notifications.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="rounded-2xl border border-border bg-muted/40 p-4 text-muted-foreground"><BellOff size={22} /></div>
                  <p className="mt-4 text-sm font-medium">All quiet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Document indexing and study milestones appear here.</p>
                </div>
              ) : (
                notifications.map((item) => (
                  <div
                    key={item.id}
                    className={cn("group rounded-xl border p-3.5 transition", item.read ? "border-border/60 bg-card/40" : "border-primary/25 bg-primary/5")}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("mt-0.5 rounded-lg border p-1.5", item.kind === "success" ? "border-success/25 bg-success/10 text-success" : "border-primary/25 bg-primary/10 text-primary")}>
                        {item.kind === "success" ? <CheckCircle2 size={14} /> : <Info size={14} />}
                      </div>
                      <button onClick={() => markRead(item)} className="min-w-0 flex-1 text-left">
                        <p className="text-sm font-medium leading-5">{item.title}</p>
                        {item.body ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p> : null}
                        <p className="mt-1.5 text-[10px] text-muted-foreground">{timeAgo(item.created_at)}</p>
                      </button>
                      <button onClick={() => remove(item.id)} className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-danger group-hover:opacity-100" aria-label="Delete notification">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
