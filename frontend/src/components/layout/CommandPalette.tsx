import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  CornerDownLeft,
  FileText,
  FlaskConical,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListTree,
  MessagesSquare,
  PencilRuler,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { api } from "../../lib/api";
import type { DocumentRecord, Topic } from "../../lib/types";
import { useApp } from "../../contexts/AppContext";
import { cn } from "../../lib/utils";

interface Item {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: typeof Search;
  run: () => void;
}

const pages = [
  { path: "/", title: "Dashboard", icon: LayoutDashboard },
  { path: "/subjects", title: "Subjects", icon: BookOpen },
  { path: "/documents", title: "Knowledge Base", icon: FileText },
  { path: "/syllabus", title: "Syllabus Analyser", icon: ListTree },
  { path: "/tutor", title: "AI Tutor", icon: MessagesSquare },
  { path: "/learn", title: "Step Teaching", icon: GraduationCap },
  { path: "/practice", title: "Practice & Exams", icon: PencilRuler },
  { path: "/labs", title: "Engineering Lab", icon: FlaskConical },
  { path: "/visuals", title: "Visual Lab", icon: Activity },
  { path: "/revision", title: "Revision", icon: Layers },
  { path: "/planner", title: "Study Planner", icon: CalendarClock },
  { path: "/analytics", title: "Analytics", icon: BarChart3 },
  { path: "/settings", title: "Settings", icon: Settings },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { subjects } = useApp();
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 40);
    Promise.all([api.topics(), api.documents()])
      .then(([topicData, documentData]) => {
        setTopics(topicData);
        setDocuments(documentData);
      })
      .catch(() => undefined);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      onClose();
    };
    const results: Item[] = [];
    const lower = query.toLowerCase().trim();
    if (lower) {
      results.push({
        id: "ask-ai",
        title: `Ask the AI tutor: “${query}”`,
        subtitle: "Open a grounded conversation",
        group: "Actions",
        icon: Sparkles,
        run: go(`/tutor?ask=${encodeURIComponent(query)}`),
      });
      results.push({
        id: "search-notes",
        title: `Search notes for “${query}”`,
        subtitle: "Semantic retrieval across your knowledge base",
        group: "Actions",
        icon: Search,
        run: go(`/documents?search=${encodeURIComponent(query)}`),
      });
    }
    pages
      .filter((page) => !lower || page.title.toLowerCase().includes(lower))
      .forEach((page) => results.push({
        id: `page-${page.path}`,
        title: page.title,
        subtitle: "Navigate",
        group: "Pages",
        icon: page.icon,
        run: go(page.path),
      }));
    subjects
      .filter((subject) => !lower || `${subject.name} ${subject.code}`.toLowerCase().includes(lower))
      .slice(0, 6)
      .forEach((subject) => results.push({
        id: `subject-${subject.id}`,
        title: subject.name,
        subtitle: `Subject${subject.code ? ` · ${subject.code}` : ""}`,
        group: "Subjects",
        icon: BookOpen,
        run: go(`/documents?subject=${subject.id}`),
      }));
    topics
      .filter((topic) => !lower || `${topic.title} ${topic.module} ${topic.subject_name}`.toLowerCase().includes(lower))
      .slice(0, 8)
      .forEach((topic) => results.push({
        id: `topic-${topic.id}`,
        title: topic.title,
        subtitle: `${topic.subject_name} · ${topic.module} · ${topic.priority} priority`,
        group: "Topics",
        icon: GraduationCap,
        run: go(`/learn/${topic.id}`),
      }));
    documents
      .filter((document) => !lower || document.filename.toLowerCase().includes(lower))
      .slice(0, 6)
      .forEach((document) => results.push({
        id: `doc-${document.id}`,
        title: document.filename,
        subtitle: `${document.doc_kind.replace("_", " ")} · ${document.page_count} pages · ${document.status}`,
        group: "Documents",
        icon: FileText,
        run: go(`/documents?subject=${document.subject_id || ""}`),
      }));
    return results;
  }, [query, subjects, topics, documents, navigate, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    items.forEach((item) => {
      const list = map.get(item.group) || [];
      list.push(item);
      map.set(item.group, list);
    });
    return Array.from(map.entries());
  }, [items]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  const runActive = () => {
    const item = items[activeIndex];
    if (item) item.run();
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[10vh]">
        <motion.div className="absolute inset-0 bg-black/[0.65] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          className="glass-panel relative w-full max-w-2xl overflow-hidden"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search size={17} className="text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onClose();
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.min(current + 1, items.length - 1));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(current - 1, 0));
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  runActive();
                }
              }}
              placeholder="Search pages, subjects, topics, notes or ask a question…"
              className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <span className="kbd">Esc</span>
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">No matches. Try another keyword or ask the AI tutor.</div>
            ) : (
              groups.map(([group, groupItems]) => (
                <div key={group} className="mb-1">
                  <p className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">{group}</p>
                  {groupItems.map((item) => {
                    const globalIndex = items.indexOf(item);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        onClick={item.run}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                          globalIndex === activeIndex ? "bg-primary/[0.12]" : "hover:bg-muted/60",
                        )}
                      >
                        <span className={cn("rounded-lg border p-1.5", globalIndex === activeIndex ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/50 text-muted-foreground")}>
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.title}</span>
                          {item.subtitle ? <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span> : null}
                        </span>
                        {globalIndex === activeIndex ? <CornerDownLeft size={13} className="text-muted-foreground" /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
            <span><span className="kbd mr-1">↑</span><span className="kbd mr-1">↓</span> navigate</span>
            <span><span className="kbd mr-1">↵</span> open</span>
            <span><span className="kbd mr-1">esc</span> close</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
