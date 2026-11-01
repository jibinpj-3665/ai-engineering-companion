import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Target } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { EvaluationResult } from "../lib/types";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Input } from "./ui/Input";
import { Progress } from "./ui/Progress";
import { Badge } from "./ui/Badge";
import { Markdown } from "./ui/Markdown";
import { useToast } from "./ui/Toast";

export function EvaluateDialog({
  open,
  onClose,
  subjectId,
  initialQuestion,
}: {
  open: boolean;
  onClose: () => void;
  subjectId?: number;
  initialQuestion?: string;
}) {
  const { toast } = useToast();
  const [question, setQuestion] = useState(initialQuestion || "");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);

  useEffect(() => {
    if (open && initialQuestion) setQuestion(initialQuestion);
  }, [open, initialQuestion]);

  const submit = async () => {
    if (!question.trim() || !answer.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const evaluation = await api.evaluateAnswer({
        question: question.trim(),
        answer: answer.trim(),
        subject_id: subjectId,
      });
      setResult(evaluation);
    } catch (err) {
      toast("Could not evaluate answer", err instanceof ApiError ? err.message : "Unexpected error", "error");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setAnswer("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Evaluate my answer"
      description="Feedback uses your uploaded material. Mastery is only recorded by a graded quiz attempt."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] leading-4 text-muted-foreground">AI feedback is formative, not a recorded grade.</p>
          <Button onClick={submit} loading={busy} disabled={!question.trim() || !answer.trim()}>
            <ClipboardCheck size={14} /> {result ? "Re-evaluate" : "Evaluate"}
          </Button>
        </div>
      }
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-muted/25 p-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 font-display text-2xl font-semibold text-primary">{result.score}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Estimated answer quality</p>
              <Progress value={result.score} className="mt-2" />
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{result.verdict || result.note || "No verdict returned."}</p>
            </div>
            <Badge><Target size={10} /> Mastery not recorded</Badge>
          </div>
          {result.strengths.length ? (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 size={13} /> What worked</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                {result.strengths.map((item, index) => <li key={index} className="flex gap-2"><span className="text-success">+</span>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {result.gaps.length ? (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-warning"><AlertTriangle size={13} /> What to fix</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                {result.gaps.map((item, index) => <li key={index} className="flex gap-2"><span className="text-warning">-</span>{item}</li>)}
              </ul>
            </div>
          ) : null}
          {result.corrected_answer ? (
            <div className="rounded-xl border border-border bg-card/50 p-4">
              <p className="mb-2 text-xs font-semibold">Model answer</p>
              <Markdown content={result.corrected_answer} />
            </div>
          ) : null}
          {result.next_step ? <p className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-xs leading-5 text-primary">{result.next_step}</p> : null}
          {result.sources?.length ? (
            <p className="text-[10px] text-muted-foreground">{result.sources.length} source{result.sources.length > 1 ? "s" : ""} from your material were checked.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Question or prompt</label>
            <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. Derive the transfer function of an RC low-pass filter." />
          </div>
          <div>
            <label className="label">Your answer</label>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={9}
              placeholder="Write your full answer, including assumptions and units…"
              className="w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-primary/40"
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}
