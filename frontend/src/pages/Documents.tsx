import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileImage,
  FileText,
  FileUp,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { DocumentRecord, SearchResult } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Input, Select } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { cn, formatBytes, formatDateTime } from "../lib/utils";

const kindLabels: Record<string, string> = {
  notes: "Notes",
  syllabus: "Syllabus",
  question_paper: "Question paper",
  lab: "Lab material",
  other: "Other",
};

export default function Documents() {
  const { subjects } = useApp();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [subjectId, setSubjectId] = useState<number | "">(params.get("subject") ? Number(params.get("subject")) : "");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docKind, setDocKind] = useState("notes");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ document: DocumentRecord; pages: { page: number; text: string; heading: string }[] } | null>(null);
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState(params.get("search") || "");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const initialSearchDone = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api.documents(subjectId === "" ? undefined : Number(subjectId));
      setDocuments(data);
    } catch (error) {
      toast("Could not load documents", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  }, [subjectId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const pending = documents.some((document) => document.status === "queued" || document.status === "processing");
    if (!pending) return;
    const timer = window.setInterval(load, 1800);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const result = await api.searchDocuments(query, subjectId === "" ? undefined : Number(subjectId), 8);
      setSearchResult(result);
    } catch (error) {
      toast("Search failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSearching(false);
    }
  }, [subjectId, toast]);

  useEffect(() => {
    if (!initialSearchDone.current && params.get("search")) {
      initialSearchDone.current = true;
      runSearch(params.get("search") || "");
    }
  }, [params, runSearch]);

  const updateSubject = (value: string) => {
    setSubjectId(value === "" ? "" : Number(value));
    const next = new URLSearchParams(params);
    if (value) next.set("subject", value);
    else next.delete("subject");
    setParams(next, { replace: true });
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files.length) return;
    setUploading(true);
    let success = 0;
    for (const file of Array.from(files)) {
      try {
        await api.uploadDocument(file, subjectId === "" ? undefined : Number(subjectId), docKind);
        success += 1;
      } catch (error) {
        toast(`Could not upload ${file.name}`, error instanceof ApiError ? error.message : "Unexpected error", "error");
      }
    }
    setUploading(false);
    if (success) {
      toast(`${success} file${success > 1 ? "s" : ""} queued`, "Text extraction and indexing run in the background.", "success");
      await load();
    }
  };

  const openPreview = async (document: DocumentRecord) => {
    try {
      const data = await api.documentPages(document.id);
      setPreview({ document: data.document, pages: data.pages });
    } catch (error) {
      toast("Could not open preview", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const reprocess = async (document: DocumentRecord) => {
    try {
      await api.reprocessDocument(document.id);
      toast("Reprocessing started", document.filename, "info");
      await load();
    } catch (error) {
      toast("Could not reprocess", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteDocument(deleting.id);
      toast("Document deleted", deleting.filename, "success");
      setDeleting(null);
      await load();
    } catch (error) {
      toast("Could not delete document", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const statusBadge = (document: DocumentRecord) => {
    if (document.status === "ready") return <Badge className="border-success/25 bg-success/[0.08] text-success"><CheckCircle2 size={10} /> Ready</Badge>;
    if (document.status === "failed") return <Badge className="border-danger/25 bg-danger/[0.08] text-danger"><AlertCircle size={10} /> Failed</Badge>;
    return <Badge className="border-warning/25 bg-warning/[0.08] text-warning"><Loader2 size={10} className="animate-spin" /> {document.status}</Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle="Upload notes, textbooks, lab manuals, question papers and syllabi. Everything is indexed locally for grounded answers."
        actions={
          <div className="flex items-center gap-2">
            <Select value={subjectId} onChange={(event) => updateSubject(event.target.value)} className="w-48">
              <option value="">All subjects</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
            <Button onClick={() => fileInput.current?.click()} loading={uploading}>
              <FileUp size={15} /> Upload
            </Button>
          </div>
        }
      />

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.tif,.tiff"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) uploadFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-5">
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files) uploadFiles(event.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          className={cn(
            "lg:col-span-3 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center transition",
            dragging ? "border-primary bg-primary/[0.08]" : "border-border bg-card/40 hover:border-primary/40 hover:bg-primary/[0.03]",
          )}
        >
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.08] p-3 text-primary">
            {uploading ? <Loader2 size={24} className="animate-spin" /> : <UploadCloud size={24} />}
          </div>
          <p className="mt-3 text-sm font-medium">{uploading ? "Uploading and indexing…" : "Drop documents here, or click to browse"}</p>
          <p className="mt-1 text-xs text-muted-foreground">PDF · DOCX · PPTX · TXT · PNG/JPG scans · up to 80 MB each</p>
          <div className="mt-4 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <Select value={docKind} onChange={(event) => setDocKind(event.target.value)} className="h-8 w-40 text-xs">
              <option value="notes">Upload as notes</option>
              <option value="syllabus">Upload as syllabus</option>
              <option value="question_paper">Question paper</option>
              <option value="lab">Lab material</option>
              <option value="other">Other</option>
            </Select>
            <Badge>{subjectId === "" ? "Unassigned" : subjects.find((subject) => subject.id === Number(subjectId))?.name}</Badge>
          </div>
        </div>

        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Search size={15} className="text-primary" /> Search your notes</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Retrieval combines local vectors and keyword overlap with exact page references.</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => { event.preventDefault(); runSearch(searchQuery); }}
            >
              <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="e.g. Nyquist criteria, CMOS latch-up…" className="h-9 text-xs" />
              <Button type="submit" size="sm" loading={searching}>Search</Button>
            </form>
            {searchResult ? (
              <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                {searchResult.sources.length === 0 ? (
                  <p className="rounded-lg border border-border/60 p-3 text-[11px] text-muted-foreground">{searchResult.note || "No indexed material matched."}</p>
                ) : (
                  searchResult.sources.map((source) => (
                    <div key={`${source.document_id}-${source.page}-${source.index}`} className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
                      <p className="text-[10px] font-medium text-primary">{source.document} · page {source.page}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{source.snippet}</p>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                <Sparkles size={12} className="mb-1 inline text-primary" /> Search results cite the exact document and page. AI answers use the same retrieval.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Upload your first PDF, DOCX or scanned note to build the knowledge engine." action={<Button onClick={() => fileInput.current?.click()}><UploadCloud size={15} /> Upload material</Button>} />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border/60 p-0">
            {documents.map((document) => (
              <div key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-muted-foreground">
                  {document.mime_type.includes("image") ? <FileImage size={17} /> : <FileText size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="max-w-full truncate text-sm font-medium">{document.filename}</p>
                    {statusBadge(document)}
                    <Badge>{kindLabels[document.doc_kind] || document.doc_kind}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatBytes(document.size_bytes)} · {document.page_count} pages/sections · {formatDateTime(document.created_at)}
                    {document.subject_id ? ` · ${subjects.find((subject) => subject.id === document.subject_id)?.name || "Subject"}` : " · Unassigned"}
                  </p>
                  {document.error ? <p className="mt-1 text-[11px] text-danger">{document.error}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openPreview(document)} disabled={document.status !== "ready"}><Eye size={13} /> Preview</Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => reprocess(document)} aria-label="Reprocess"><RefreshCw size={14} /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(document)} aria-label="Delete"><Trash2 size={14} className="text-danger" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.document.filename}
        description={`${preview?.document.page_count || 0} pages/sections extracted${preview?.document.error ? ` · ${preview.document.error}` : ""}`}
        size="lg"
      >
        <div className="space-y-3">
          {preview?.pages.map((page) => (
            <div key={page.page} className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">Page / section {page.page}{page.heading ? ` · ${page.heading}` : ""}</p>
              <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-6 text-muted-foreground">{page.text}</pre>
            </div>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete document?"
        description={`${deleting?.filename || "This file"} will be removed from disk and its search index.`}
        size="sm"
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={remove}><Trash2 size={14} /> Delete</Button></div>}
      >
        <p className="text-sm text-muted-foreground">Generated quizzes and flashcards remain, but AI answers will no longer cite this document.</p>
      </Dialog>

      {uploading ? <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 shadow-panel"><Spinner label="Uploading files" /></div> : null}
    </div>
  );
}
