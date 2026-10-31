import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, FileText, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Subject } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Input, Textarea } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Progress } from "../components/ui/Progress";

const emptyForm = { name: "", code: "", semester: "", department: "", description: "" };

export default function Subjects() {
  const { subjects, refreshSubjects } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Subject | null>(null);
  const [menu, setMenu] = useState<number | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (subject: Subject) => {
    setEditing(subject);
    setForm({
      name: subject.name,
      code: subject.code,
      semester: subject.semester,
      department: subject.department,
      description: subject.description,
    });
    setMenu(null);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast("Subject name required", "Give the subject a clear name.", "warning");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateSubject(editing.id, form);
        toast("Subject updated", form.name, "success");
      } else {
        await api.createSubject(form);
        toast("Subject created", "Upload notes and a syllabus next.", "success");
      }
      setOpen(false);
      await refreshSubjects();
    } catch (error) {
      toast("Could not save subject", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteSubject(deleting.id);
      toast("Subject deleted", `${deleting.name} and its documents were removed.`, "success");
      setDeleting(null);
      await refreshSubjects();
    } catch (error) {
      toast("Could not delete subject", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Subjects"
        subtitle="Organise every semester subject, its documents and syllabus in one workspace."
        actions={<Button onClick={openCreate}><Plus size={16} /> New subject</Button>}
      />

      {subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects yet"
          description="Start with one subject. You can add syllabus topics, notes and exams to it."
          action={<Button onClick={openCreate}><Plus size={15} /> Create your first subject</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject) => {
            const completion = subject.topic_count ? Math.round(((subject.mastered_count || 0) / subject.topic_count) * 100) : 0;
            return (
              <Card key={subject.id} className="group relative overflow-hidden transition hover:border-primary/30">
                <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-primary/5 blur-2xl" />
                <CardContent className="relative p-5">
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => navigate(`/documents?subject=${subject.id}`)} className="flex min-w-0 items-center gap-3 text-left">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)/0.2),hsl(var(--accent-2)/0.12))] text-sm font-bold text-primary">
                        {(subject.code || subject.name).slice(0, 3).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-display text-[0.95rem] font-semibold">{subject.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[subject.code, subject.semester].filter(Boolean).join(" · ") || "No code yet"}
                        </p>
                      </div>
                    </button>
                    <div className="relative">
                      <Button variant="ghost" size="icon-sm" onClick={() => setMenu(menu === subject.id ? null : subject.id)} aria-label="Subject actions">
                        <MoreVertical size={15} />
                      </Button>
                      {menu === subject.id ? (
                        <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-border bg-card p-1 shadow-panel">
                          <button onClick={() => openEdit(subject)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-muted"><Pencil size={13} /> Edit</button>
                          <button onClick={() => { setDeleting(subject); setMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-danger hover:bg-danger/10"><Trash2 size={13} /> Delete</button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {subject.description ? <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{subject.description}</p> : null}

                  <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><BookOpen size={12} /> {subject.topic_count || 0} topics</span>
                    <span className="flex items-center gap-1"><FileText size={12} /> {subject.document_count || 0} docs</span>
                    <span>{subject.mastered_count || 0} mastered</span>
                  </div>
                  <Progress value={completion} className="mt-2.5" />

                  <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/documents?subject=${subject.id}`)}>Knowledge base</Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/syllabus?subject=${subject.id}`)}>Syllabus</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit subject" : "Create subject"}
        description="Subjects group documents, topics, quizzes and study analytics."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editing ? "Save changes" : "Create subject"}</Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <div>
            <label className="label">Subject name *</label>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Digital Signal Processing" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Subject code</label>
              <Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="ECE301" />
            </div>
            <div>
              <label className="label">Semester</label>
              <Input value={form.semester} onChange={(event) => setForm({ ...form, semester: event.target.value })} placeholder="S5" />
            </div>
          </div>
          <div>
            <label className="label">Department</label>
            <Input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="Electronics and Communication" />
          </div>
          <div>
            <label className="label">Description</label>
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Signals, transforms, filters and DSP implementation." />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete subject?"
        description={`${deleting?.name || "This subject"} will be removed with its documents, topics, quizzes, flashcards and exams. This cannot be undone.`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}><Trash2 size={15} /> Delete subject</Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">Protect your work: download a backup from Settings before deleting large subjects.</p>
      </Dialog>
    </div>
  );
}
