import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookMarked,
  BookOpenCheck,
  CheckCircle2,
  Download,
  FileText,
  FolderUp,
  GraduationCap,
  Layers,
  LibraryBig,
  ListTree,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  Target,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type {
  DocumentRecord,
  LibraryBatch,
  LibraryOverview,
  LibrarySearchResult,
  LibrarySubject,
  LibrarySubjectDetail,
  SyllabusModuleRecord,
  Topic,
} from "../lib/types";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";
import { Spinner } from "../components/ui/Spinner";
import { Tabs } from "../components/ui/Tabs";
import { cn, formatBytes, statusLabels, statusStyle } from "../lib/utils";

declare global {
  interface Window {
    aec?: {
      pickFolder?: () => Promise<string | null>;
      info?: () => Promise<Record<string, unknown>>;
    };
  }
}

const batchStatusStyle: Record<string, string> = {
  imported: "border-success/30 bg-success/10 text-success",
  duplicate: "border-primary/30 bg-primary/10 text-primary",
  skipped: "border-warning/30 bg-warning/10 text-warning",
  unsupported: "border-muted-foreground/30 bg-muted text-muted-foreground",
  failed: "border-danger/30 bg-danger/10 text-danger",
};

function documentKindLabel(kind: string): string {
  if (kind === "syllabus") return "Syllabus";
  if (kind === "question_paper") return "Question paper";
  if (kind === "lab") return "Lab manual";
  if (kind === "reference") return "Reference";
  return "Notes";
}

function sourceLink(document: DocumentRecord, page?: number | null) {
  return `${api.documentDownloadUrl(document.id)}${page ? `#page=${page}` : ""}`;
}

export default function SyllabusLibrary() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<LibrarySearchResult[] | null>(null);
  const [yearFilter, setYearFilter] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LibrarySubjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");
  const [busyDocument, setBusyDocument] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [lastBatch, setLastBatch] = useState<LibraryBatch | null>(null);
  const desktopAvailable = typeof window !== "undefined" && Boolean(window.aec?.pickFolder);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed("");
    try {
      setOverview(await api.library());
    } catch (error) {
      setFailed(error instanceof ApiError ? error.message : "Could not load the syllabus library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (subjectId: number, tab = "overview") => {
    setDetailId(subjectId);
    setDetailTab(tab);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await api.librarySubject(subjectId));
    } catch (error) {
      toast("Could not open subject", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const years = useMemo(() => Array.from(new Set((overview?.subjects || []).map((subject) => subject.academic_year).filter(Boolean))).sort(), [overview]);
  const filteredSubjects = useMemo(
    () => (overview?.subjects || []).filter((subject) => !yearFilter || subject.academic_year === yearFilter),
    [overview, yearFilter],
  );
  const semesterGroups = useMemo(() => {
    const map = new Map<string, LibrarySubject[]>();
    filteredSubjects.forEach((subject) => {
      const semester = subject.semester || "Unassigned";
      const list = map.get(semester) || [];
      list.push(subject);
      map.set(semester, list);
    });
    return Array.from(map.entries()).sort(([left], [right]) => (left === "Unassigned" ? 1 : right === "Unassigned" ? -1 : left.localeCompare(right)));
  }, [filteredSubjects]);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const result = await api.librarySearch(query.trim());
      setSearchResults(result.results);
    } catch (error) {
      toast("Search failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSearching(false);
    }
  };

  const chooseFolder = async () => {
    if (!window.aec?.pickFolder) {
      toast("Folder picker unavailable", "Paste the local folder path instead. Folder import only works from the desktop app.", "info");
      return;
    }
    const selected = await window.aec.pickFolder();
    if (selected) setFolderPath(selected);
  };

  const importFolder = async () => {
    if (!folderPath.trim()) {
      toast("Choose a folder", "Select the folder that contains your syllabus files.", "warning");
      return;
    }
    setImporting(true);
    setLastBatch(null);
    try {
      const batch = await api.libraryImport(folderPath.trim());
      setLastBatch(batch);
      toast(
        "Syllabus import finished",
        `${batch.imported_files} imported · ${batch.duplicate_files} duplicate · ${batch.skipped_files} skipped · ${batch.unsupported_files} unsupported · ${batch.failed_files} failed`,
        batch.failed_files ? "warning" : "success",
      );
      await load();
    } catch (error) {
      toast("Folder import failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setImporting(false);
    }
  };

  const updateStatus = async (topic: Topic, status: string) => {
    try {
      const updated = await api.updateTopic(topic.id, { status });
      setDetail((current) => current ? { ...current, topics: current.topics.map((item) => item.id === updated.id ? updated : item) } : current);
      await load();
    } catch (error) {
      toast("Could not update progress", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const reparse = async (document: DocumentRecord) => {
    setBusyDocument(document.id);
    try {
      await api.libraryReparse(document.id);
      toast("Syllabus re-parsed", `${document.filename} was refreshed from its stored copy.`, "success");
      await load();
      if (detailId) await openDetail(detailId, detailTab);
    } catch (error) {
      toast("Could not re-parse", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setBusyDocument(null);
    }
  };

  const unindex = async (document: DocumentRecord) => {
    if (!window.confirm(`Remove “${document.filename}” from search and the library index? The stored copy and your original file stay on disk.`)) return;
    setBusyDocument(document.id);
    try {
      await api.libraryUnindex(document.id);
      toast("Index removed", "The document is no longer searchable. Its stored copy was preserved.", "success");
      await load();
      if (detailId) await openDetail(detailId, "documents");
    } catch (error) {
      toast("Could not remove index", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setBusyDocument(null);
    }
  };

  if (loading) return <PageLoader label="Opening syllabus library" />;
  if (failed) {
    return <EmptyState icon={LibraryBig} title="Library unavailable" description={failed} action={<Button onClick={load}>Retry</Button>} />;
  }
  if (!overview) return null;

  const hasLibrary = overview.totals.subjects > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Syllabus Library"
        subtitle="Browse imported university syllabi by semester and subject, inspect modules and outcomes, and track your own completion."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a href={api.libraryManifestUrl()} target="_blank" rel="noreferrer"><Button variant="outline"><Download size={15} /> Manifest</Button></a>
            <Button onClick={() => { setImportOpen(true); setLastBatch(null); }}><FolderUp size={15} /> Import folder</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Semesters", value: overview.totals.semesters, icon: Layers },
          { label: "Subjects", value: overview.totals.subjects, icon: BookOpenCheck },
          { label: "Modules", value: overview.totals.modules, icon: ListTree },
          { label: "Topics", value: overview.totals.topics, icon: ScrollText },
          { label: "Indexed docs", value: overview.totals.indexed_documents, icon: FileText },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="glass-panel flex items-center gap-3 p-4">
              <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary"><Icon size={17} /></span>
              <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p><p className="font-display text-xl font-semibold">{item.value}</p></div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={runSearch} className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value.trim()) setSearchResults(null); }} placeholder="Search subjects, codes, modules or syllabus topics…" className="pl-9" />
            </div>
            <Select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="sm:w-44">
              <option value="">All academic years</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </Select>
            <Button type="submit" loading={searching}><Search size={14} /> Search</Button>
          </form>
          <p className="mt-2 text-[11px] text-muted-foreground">{overview.note}</p>
        </CardContent>
      </Card>

      {searchResults ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Search results</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => { setSearchResults(null); setQuery(""); }}>Clear</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {searchResults.length === 0 ? <p className="text-xs text-muted-foreground">No subject, module or topic matched “{query}”. Try a course code such as 24ECT501.</p> : searchResults.map((result, index) => (
              <button key={`${result.kind}-${result.subject_id}-${index}`} onClick={() => openDetail(result.subject_id, result.kind === "module" ? "modules" : result.kind === "topic" ? "topics" : "overview")} className="flex w-full flex-col gap-1 rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition hover:border-primary/35 sm:flex-row sm:items-center">
                <Badge className="w-fit shrink-0">{result.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{result.title}</p>
                  <p className="text-[10px] text-muted-foreground">{result.subject}{result.course_code ? ` · ${result.course_code}` : ""}{result.module ? ` · ${result.module}` : ""}</p>
                </div>
                {result.document_id ? (
                  <a href={`${api.documentDownloadUrl(result.document_id)}${result.page ? `#page=${result.page}` : ""}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-[10px] text-primary hover:underline">
                    {result.document}{result.page ? ` · p.${result.page}` : ""}
                  </a>
                ) : null}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!hasLibrary ? (
        <EmptyState
          icon={LibraryBig}
          title="No syllabus imported yet"
          description="Import a folder of syllabus PDFs, DOCX, PPTX, TXT or Markdown files. Originals are never changed, and duplicates are detected by SHA-256."
          action={<Button onClick={() => setImportOpen(true)}><FolderUp size={15} /> Import syllabus folder</Button>}
        />
      ) : (
        <div className="space-y-5">
          {semesterGroups.length === 0 ? <p className="text-xs text-muted-foreground">No subjects match the selected academic year.</p> : semesterGroups.map(([semester, subjects]) => {
            const semesterMeta = overview.semesters.find((item) => item.semester === semester);
            const progress = semesterMeta?.progress ?? (subjects.length ? subjects.reduce((sum, subject) => sum + subject.progress, 0) / subjects.length : 0);
            return (
              <Card key={semester}>
                <CardHeader className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2"><GraduationCap size={17} className="text-primary" /><CardTitle>{semester === "Unassigned" ? "Unassigned semester" : semester}</CardTitle></div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge>{subjects.length} subjects</Badge>
                    <Badge>{subjects.reduce((sum, subject) => sum + subject.module_count, 0)} modules</Badge>
                    <Badge>{subjects.reduce((sum, subject) => sum + subject.topic_count, 0)} topics</Badge>
                    {semesterMeta?.credits ? <Badge>{semesterMeta.credits} credits</Badge> : null}
                    <span className="w-28"><Progress value={progress} /></span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 lg:grid-cols-2">
                  {subjects.map((subject) => (
                    <button key={subject.id} onClick={() => openDetail(subject.id)} className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-left transition hover:border-primary/35 hover:bg-primary/[0.04]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="border-primary/25 text-primary">{subject.code || "No code"}</Badge>
                            {subject.academic_year ? <span className="text-[10px] text-muted-foreground">{subject.academic_year}</span> : null}
                            {subject.semester_source === "inferred_from_course_code" ? <span className="text-[10px] text-warning">semester inferred from code</span> : null}
                          </div>
                          <p className="mt-2 font-display text-base font-semibold">{subject.name}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">{subject.module_count} modules · {subject.topic_count} topics · {subject.outcome_count} COs · {subject.credits || 0} credits</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">{Math.round(subject.progress)}%</span>
                      </div>
                      <Progress value={subject.progress} className="mt-3" />
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                        <span>{subject.mastered_count} mastered</span>
                        <span>{subject.completed_topics} learned or mastered</span>
                        <span>{subject.document_count} indexed source{document_count_plural(subject.document_count)}</span>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><RefreshCw size={15} className="text-primary" /> Recent imports</CardTitle>
          <a href={api.libraryManifestUrl()} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Full manifest</a>
        </CardHeader>
        <CardContent className="space-y-2">
          {overview.recent_batches.length === 0 ? <p className="text-xs text-muted-foreground">No imports yet. Use “Import folder” to build the library.</p> : overview.recent_batches.slice(0, 4).map((batch) => (
            <div key={batch.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{batch.source_root}</p>
                <p className="text-[10px] text-muted-foreground">{batch.total_files} discovered · {batch.imported_files} imported · {batch.duplicate_files} duplicate · {batch.skipped_files} skipped · {batch.unsupported_files} unsupported · {batch.failed_files} failed</p>
              </div>
              <Badge className={cn("w-fit", batch.status.startsWith("completed") ? "border-success/30 text-success" : "border-danger/30 text-danger")}>{batch.status.replaceAll("_", " ")}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={importOpen} onClose={() => { if (!importing) setImportOpen(false); }} title="Import a syllabus folder" description="The app copies supported files into its own storage. Your original files are never renamed, moved or changed." size="lg">
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-5 text-muted-foreground">
            Supported: PDF, DOCX, PPTX, TXT, Markdown and images. Legacy .doc, .rtf, .odt and spreadsheets are reported as unsupported. Scanned files need Tesseract OCR.
            Folder import is rejected by the backend for remote deployments; upload through the Knowledge Base there.
          </div>
          <div>
            <label className="label">Local folder path</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="C:\Users\you\Downloads\Syllabus" />
              {desktopAvailable ? <Button type="button" variant="outline" onClick={chooseFolder}><FolderUp size={14} /> Choose folder</Button> : null}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">{desktopAvailable ? "Use the native folder picker, or paste a path." : "Folder import is only available inside the desktop app. You can still add individual files from the Knowledge Base."}</p>
          </div>
          {lastBatch ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Imported", lastBatch.imported_files],
                  ["Duplicates", lastBatch.duplicate_files],
                  ["Skipped", lastBatch.skipped_files],
                  ["Unsupported", lastBatch.unsupported_files],
                  ["Failed", lastBatch.failed_files],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-border bg-muted/25 p-2.5 text-center">
                    <p className="font-display text-lg font-semibold">{value}</p>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {lastBatch.manifest.map((file) => (
                  <div key={file.relative_path} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={batchStatusStyle[file.status]}>{file.status}</Badge>
                      <p className="min-w-0 flex-1 truncate text-xs font-medium">{file.relative_path}</p>
                      {file.document_id ? <a href={api.documentDownloadUrl(file.document_id)} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">Open copy</a> : null}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">{file.course_code} {file.course_title}{file.pages ? ` · ${file.pages} pages` : ""}{file.topics ? ` · ${file.modules} modules · ${file.topics} topics · ${file.course_outcomes} COs` : ""}</p>
                    {file.message ? <p className="mt-1 text-[10px] text-muted-foreground">{file.message}</p> : null}
                    {file.warnings.length ? <p className="mt-1 text-[10px] text-warning">{file.warnings.join(" ")}</p> : null}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Original files in the source folder were not modified.</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setImportOpen(false)} disabled={importing}>{lastBatch ? "Close" : "Cancel"}</Button>
          <Button onClick={importFolder} loading={importing} disabled={importing || !folderPath.trim()}>{lastBatch ? "Re-import folder" : "Import folder"}</Button>
        </div>
      </Dialog>

      <Dialog
        open={detailId !== null}
        onClose={() => { setDetailId(null); setDetail(null); }}
        title={detail?.subject.name || "Loading subject"}
        description={detail ? `${detail.subject.code || "No course code"} · ${detail.subject.semester || "Semester not stated"} · ${detail.subject.credits || 0} credits · ${detail.progress.completion}% weighted completion` : "Loading syllabus structure"}
        size="xl"
      >
        {detailLoading ? <div className="py-16"><Spinner label="Loading syllabus" /></div> : !detail ? <p className="text-sm text-muted-foreground">Subject could not be loaded.</p> : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["Modules", detail.progress.modules],
                ["Topics", detail.progress.topics],
                ["Mastered", detail.progress.mastered],
                ["Course outcomes", detail.course_outcomes.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-muted/25 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 font-display text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>Your weighted completion</span><span>{detail.progress.completion}%</span></div>
              <Progress value={detail.progress.completion} className="mt-1.5" />
              <p className="mt-1.5 text-[10px] text-muted-foreground">{detail.note}</p>
            </div>

            <Tabs
              value={detailTab}
              onChange={setDetailTab}
              className="w-fit"
              items={[
                { id: "overview", label: "Overview", icon: BookMarked },
                { id: "modules", label: "Modules", icon: ListTree, count: detail.modules.length },
                { id: "topics", label: "Topics", icon: Target, count: detail.topics.length },
                { id: "outcomes", label: "COs", icon: CheckCircle2, count: detail.course_outcomes.length },
                { id: "documents", label: "Sources", icon: FileText, count: detail.documents.length },
              ]}
            />

            {detailTab === "overview" ? (
              <div className="space-y-4 text-sm leading-6">
                <div className="flex flex-wrap gap-2">
                  {detail.subject.academic_year ? <Badge>Academic year {detail.subject.academic_year}</Badge> : null}
                  {detail.subject.ltp ? <Badge>L-T-P-R-C {detail.subject.ltp}</Badge> : null}
                  <Badge className={detail.subject.semester_source === "explicit" ? "border-success/30 text-success" : "border-warning/30 text-warning"}>
                    Semester {detail.subject.semester || "not stated"} {detail.subject.semester_source === "explicit" ? "(explicit in source)" : detail.subject.semester_source ? "(inferred from course code)" : ""}
                  </Badge>
                </div>
                <div><p className="label">Preamble</p><p className="text-muted-foreground">{detail.subject.preamble || detail.subject.description || "Not provided in the imported document."}</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><p className="label">Prerequisites</p><p className="text-muted-foreground">{detail.subject.prerequisites || "Not provided."}</p></div>
                  <div><p className="label">Corequisites</p><p className="text-muted-foreground">{detail.subject.corequisites || "Not provided."}</p></div>
                </div>
                {detail.subject.books?.text_books?.length ? <div><p className="label">Text books</p><ul className="list-decimal space-y-1 pl-5 text-muted-foreground">{detail.subject.books.text_books.map((book) => <li key={book}>{book}</li>)}</ul></div> : null}
                {detail.subject.books?.reference_books?.length ? <div><p className="label">Reference books</p><ul className="list-decimal space-y-1 pl-5 text-muted-foreground">{detail.subject.books.reference_books.map((book) => <li key={book}>{book}</li>)}</ul></div> : null}
              </div>
            ) : null}

            {detailTab === "modules" ? (
              <div className="space-y-3">
                {detail.modules.map((module) => <ModuleCard key={module.id} module={module} documents={detail.documents} />)}
              </div>
            ) : null}

            {detailTab === "topics" ? (
              <div className="space-y-3">
                {detail.modules.map((module) => {
                  const topics = detail.topics.filter((topic) => topic.module_id === module.id || (topic.module_id == null && topic.module.startsWith(module.label)));
                  if (!topics.length) return null;
                  return (
                    <div key={module.id} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold">{module.label}: {module.title}</p>
                        <span className="text-[10px] text-muted-foreground">{topics.length} topics · pages {module.page_start}{module.page_end !== module.page_start ? `-${module.page_end}` : ""}</span>
                      </div>
                      <div className="mt-2 space-y-2">
                        {topics.map((topic) => (
                          <div key={topic.id} className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/35 p-2.5 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium">{topic.topic_number ? <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{topic.topic_number}</span> : null}{topic.title}</p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">{topic.content_type === "tutorial" ? "Tutorial · " : ""}{topic.priority.toUpperCase()} priority · {Math.round(topic.mastery_score)}% mastery{topic.source_page ? ` · source p.${topic.source_page}` : ""}</p>
                              <Progress value={topic.mastery_score} className="mt-1.5 h-1 max-w-48" />
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <Select value={topic.status} onChange={(event) => updateStatus(topic, event.target.value)} className={cn("h-8 w-32 text-[11px]", statusStyle[topic.status])}>
                                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </Select>
                              <Link to={`/learn/${topic.id}`}><Button size="sm" variant="outline">Teach</Button></Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {detailTab === "outcomes" ? (
              <div className="space-y-2">
                {detail.course_outcomes.length === 0 ? <p className="text-xs text-muted-foreground">No course outcomes were detected in this document.</p> : detail.course_outcomes.map((outcome) => (
                  <div key={outcome.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border-primary/30 text-primary">{outcome.code}</Badge>
                      <Badge>{outcome.bloom_level || "Bloom level not stated"}</Badge>
                      <span className="text-[10px] text-muted-foreground">source p.{outcome.page}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{outcome.description}</p>
                    {outcome.po_mapping?.length ? <p className="mt-1 text-[10px] text-muted-foreground">CO-PO: {outcome.po_mapping.map((value, index) => `PO${index + 1}:${value ?? "-"}`).join(" ")}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {detailTab === "documents" ? (
              <div className="space-y-2">
                {detail.documents.length === 0 ? <p className="text-xs text-muted-foreground">No source documents linked to this subject.</p> : detail.documents.map((document) => (
                  <div key={document.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                      <FileText size={17} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{document.filename}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{documentKindLabel(document.doc_kind)} · {document.page_count} pages · v{document.version || 1} · {formatBytes(document.size_bytes)} · {document.status}{document.active === false ? " · not indexed" : ""}</p>
                        <p className="mt-1 break-all text-[10px] text-muted-foreground">{document.source_path || document.source_identity || "Uploaded through the app"}</p>
                        {document.sha256 ? <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">SHA-256 {document.sha256.slice(0, 20)}…</p> : null}
                        {document.error ? <p className="mt-1 text-[10px] text-warning">{document.error}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {document.status === "ready" ? <a href={sourceLink(document)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Download size={12} /> Open</Button></a> : null}
                        <Button size="sm" variant="outline" onClick={() => reparse(document)} loading={busyDocument === document.id}><RefreshCw size={12} /> Re-parse</Button>
                        {document.active !== false ? <Button size="sm" variant="ghost" onClick={() => unindex(document)} loading={busyDocument === document.id}><Trash2 size={12} /> Unindex</Button> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function document_count_plural(count: number): string {
  return count === 1 ? "" : "s";
}

function ModuleCard({ module, documents }: { module: SyllabusModuleRecord; documents: DocumentRecord[] }) {
  const document = documents.find((item) => item.id === module.document_id);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{module.label}: {module.title}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{module.lecture_hours} L{module.tutorial_hours ? ` + ${module.tutorial_hours} T` : ""}{module.practical_hours ? ` + ${module.practical_hours} P` : ""}{module.self_study_hours ? ` · ${module.self_study_hours} self-study hours` : ""} · pages {module.page_start}{module.page_end !== module.page_start ? `-${module.page_end}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{module.topic_count} topics</Badge>
          {document ? <a href={`${api.documentDownloadUrl(document.id)}#page=${module.page_start}`} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline">Source p.{module.page_start}</a> : null}
        </div>
      </div>
      {module.description ? (
        <div className="mt-2">
          <p className={cn("text-xs leading-5 text-muted-foreground", !expanded && "line-clamp-3")}>{module.description}</p>
          {module.description.length > 260 ? <button onClick={() => setExpanded(!expanded)} className="mt-1 text-[10px] text-primary hover:underline">{expanded ? "Show less" : "Show full module description"}</button> : null}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Progress value={module.topic_count ? (module.mastered + module.learned * 0.75 + module.in_progress * 0.35) / module.topic_count * 100 : 0} className="max-w-52" />
        <span className="text-[10px] text-muted-foreground">Your progress in this module</span>
      </div>
    </div>
  );
}

function PageLoader({ label }: { label: string }) {
  return <div className="py-20"><Spinner label={label} /></div>;
}
