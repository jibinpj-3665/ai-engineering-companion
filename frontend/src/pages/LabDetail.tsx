import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";
import {
  ArrowLeft,
  Beaker,
  BookOpen,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FlaskConical,
  Lightbulb,
  ListChecks,
  Play,
  RotateCcw,
  Save,
  Terminal,
  Wrench,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { LabDetail as LabDetailType } from "../lib/types";
import { useToast } from "../components/ui/Toast";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { PageLoader } from "../components/ui/Spinner";
import { Markdown } from "../components/ui/Markdown";
import { Tabs } from "../components/ui/Tabs";
import { cn, downloadText, formatDateTime } from "../lib/utils";

function languageExtension(language: string): Extension[] {
  const value = language.toLowerCase();
  if (value.includes("python")) return [python()];
  if (value.includes("verilog") || value.includes("c++") || value === "c" || value.includes("arduino")) return [cpp()];
  if (value.includes("javascript") || value.includes("js")) return [javascript()];
  return [];
}

export default function LabDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lab, setLab] = useState<LabDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("experiment");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api.lab(slug)
      .then((data) => {
        setLab(data);
        setCode(data.saved_code || data.code);
        setLanguage(data.saved_language || data.language);
      })
      .catch((error) => {
        toast("Could not load lab", error instanceof ApiError ? error.message : "Unexpected error", "error");
      })
      .finally(() => setLoading(false));
  }, [slug, toast]);

  const extensions = useMemo(() => languageExtension(language), [language]);

  if (loading && !lab) return <PageLoader label="Loading lab bench" />;
  if (!lab) return <EmptyState icon={FlaskConical} title="Lab not found" description="This experiment does not exist." action={<Button onClick={() => navigate("/labs")}>Back to labs</Button>} />;

  const save = async () => {
    setSaving(true);
    try {
      await api.saveLabArtifact(lab.slug, code, language);
      setLab({ ...lab, saved_code: code, saved_language: language, saved_at: new Date().toISOString() });
      toast("Artifact saved", "Your code is stored with this lab on this device.", "success");
    } catch (error) {
      toast("Could not save artifact", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    toast("Code copied", undefined, "success");
  };

  const download = () => {
    const ext = language.toLowerCase().includes("python") ? "py" : language.toLowerCase().includes("verilog") ? "v" : language.toLowerCase().includes("javascript") ? "js" : language.toLowerCase().includes("arduino") ? "ino" : "cpp";
    downloadText(`${lab.slug}.${ext}`, code, "text/plain");
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => navigate("/labs")}><ArrowLeft size={14} /> All labs</Button>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{lab.domain}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{lab.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{lab.difficulty}</Badge>
            <Badge>{lab.duration_minutes} min</Badge>
            <Badge><Wrench size={10} /> {lab.language}</Badge>
            {lab.saved_at ? <Badge className="border-success/25 text-success"><CheckCircle2 size={10} /> Saved {formatDateTime(lab.saved_at)}</Badge> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copy}><ClipboardCopy size={14} /> Copy code</Button>
          <Button variant="gradient" onClick={save} loading={saving}><Save size={14} /> Save artifact</Button>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary"><Lightbulb size={11} /> Objective</p>
        <p className="mt-1.5 text-sm leading-6 text-foreground/90">{lab.objective}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{lab.components.map((component) => <Badge key={component}>{component}</Badge>)}</div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4 w-fit"
        items={[
          { id: "experiment", label: "Theory", icon: BookOpen },
          { id: "procedure", label: "Procedure", icon: ListChecks },
          { id: "simulation", label: "Simulation", icon: Terminal },
          { id: "viva", label: "Viva & debug", icon: Beaker },
        ]}
      />

      {tab === "experiment" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Theory</CardTitle></CardHeader><CardContent><Markdown content={lab.theory} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Schematic / block diagram</CardTitle></CardHeader><CardContent><Markdown content={lab.diagram} /></CardContent></Card>
        </div>
      ) : null}

      {tab === "procedure" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Algorithm / procedure</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2.5">
                {lab.algorithm.map((step, index) => (
                  <li key={index} className="flex gap-3 text-sm leading-6">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.08] text-[10px] font-semibold text-primary">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Code walkthrough</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {lab.code_explanation.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-6 text-muted-foreground"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-primary" />{item}</li>
                ))}
              </ul>
              {lab.ltspice ? (
                <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary"><Play size={10} /> LTspice</p>
                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">{lab.ltspice}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "simulation" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div><CardTitle>Interactive artifact</CardTitle><p className="mt-1 text-xs text-muted-foreground">Edit, save and run this experiment outside the app. The editor does not execute code.</p></div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setCode(lab.code)}><RotateCcw size={12} /> Reset</Button>
                <Button size="sm" variant="outline" onClick={download}><Download size={12} /> Download</Button>
                <Button size="sm" onClick={save} loading={saving}><Save size={12} /> Save</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-border">
                <CodeMirror value={code} height="380px" theme={oneDark} extensions={extensions} onChange={(value) => setCode(value)} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true }} />
              </div>
              {lab.saved_code && lab.saved_code !== lab.code ? <p className="mt-2 text-[10px] text-success">Saved artifact restored from your previous session. Reset restores the lab template.</p> : null}
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Expected output</CardTitle></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-xl border border-border bg-[#0c1017] p-4 font-mono text-[11px] leading-5 text-slate-300">{lab.expected_output}</pre></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Result & observations</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">{lab.result}</p>
                <div className="mt-3 rounded-lg border border-warning/25 bg-warning/5 p-4 text-xs leading-6 text-warning">{lab.disclaimer}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "viva" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Viva questions</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2.5">
                {lab.viva.map((question, index) => (
                  <li key={index} className="flex gap-2.5 text-sm leading-6"><span className={cn("shrink-0 font-mono text-[10px]", index % 2 ? "text-accent" : "text-primary")}>Q{index + 1}.</span>{question}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Troubleshooting</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {lab.troubleshooting.map((item, index) => (
                  <li key={index} className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
