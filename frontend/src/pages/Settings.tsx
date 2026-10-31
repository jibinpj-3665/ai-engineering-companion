import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Keyboard,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Volume2,
  Zap,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Settings as SettingsType } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input, Select, Textarea } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Switch } from "../components/ui/Switch";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../lib/utils";

const accents = [
  { id: "violet", label: "Violet", color: "#8b5cf6" },
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "emerald", label: "Emerald", color: "#10b981" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
];

const personalities = [
  { id: "study_buddy", label: "Friendly Study Buddy" },
  { id: "professor", label: "Professional Professor" },
  { id: "examiner", label: "Strict Examiner" },
  { id: "mentor", label: "Engineering Mentor" },
  { id: "beginner_teacher", label: "Beginner-Friendly Teacher" },
];

export default function Settings() {
  const { settings, setSettings, aiStatus, refreshAIStatus, loading } = useApp();
  const { toast } = useToast();
  const [form, setForm] = useState<SettingsType | null>(settings);
  const [apiKey, setApiKey] = useState("");
  const [savingAI, setSavingAI] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (settings) setForm(settings); }, [settings]);

  if (loading || !form) return <div className="py-24"><Spinner label="Loading preferences" /></div>;

  const update = (key: keyof SettingsType, value: string) => setForm((current) => current ? { ...current, [key]: value } : current);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api.updateSettings({
        student_name: form.student_name,
        theme: form.theme,
        accent: form.accent,
        daily_goal_minutes: form.daily_goal_minutes,
        personality: form.personality,
        voice_enabled: form.voice_enabled,
      });
      setSettings(updated);
      toast("Profile saved", "Appearance and study defaults updated.", "success");
    } catch (error) {
      toast("Could not save profile", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAI = async (thenTest = false) => {
    setSavingAI(true);
    try {
      const payload: Record<string, string> = {
        ai_provider: form.ai_provider,
        ai_base_url: form.ai_base_url,
        ai_model: form.ai_model,
        ai_embedding_model: form.ai_embedding_model,
        ai_temperature: form.ai_temperature,
        ai_max_tokens: form.ai_max_tokens,
        embedding_provider: form.embedding_provider,
        local_base_url: form.local_base_url,
        local_model: form.local_model,
      };
      if (apiKey.trim()) payload.ai_api_key = apiKey.trim();
      const updated = await api.updateSettings(payload);
      setSettings(updated);
      setApiKey("");
      await refreshAIStatus();
      toast("AI settings saved", updated.ai_configured ? "Provider configuration is complete." : "Saved. Add the missing fields to activate the provider.", "success");
      if (thenTest) await testConnection();
    } catch (error) {
      toast("Could not save AI settings", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setSavingAI(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await api.testAI();
      toast(result.ok ? "Connection successful" : "Connection check failed", result.message, result.ok ? "success" : "error");
    } catch (error) {
      toast("Connection check failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setTesting(false);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const result = await api.reindex();
      toast("Re-indexing started", result.message, "success");
    } catch (error) {
      toast("Could not start re-index", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setReindexing(false);
    }
  };

  const restore = async (file: File) => {
    if (!window.confirm("Restore this backup? Current data will be replaced.")) return;
    setRestoring(true);
    try {
      const result = await api.restoreBackup(file);
      toast("Backup restored", result.message || "Reloading the app…", "success");
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toast("Restore failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const provider = form.ai_provider;
  const usesRemote = provider !== "offline";

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Your profile, appearance, AI provider and local data — all stored on this device." actions={<Badge><ShieldCheck size={11} /> Local-first</Badge>} />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User size={15} className="text-primary" /> Profile & study defaults</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Your name</label><Input value={form.student_name} onChange={(event) => update("student_name", event.target.value)} placeholder="Engineer" /></div>
                <div><label className="label">Daily study goal (minutes)</label><Input type="number" min={15} max={900} value={form.daily_goal_minutes} onChange={(event) => update("daily_goal_minutes", event.target.value)} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Default tutor personality</label><Select value={form.personality} onChange={(event) => update("personality", event.target.value)}>{personalities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div>
                <div><label className="label">Voice responses</label><div className="flex h-10 items-center justify-between rounded-xl border border-border bg-muted/25 px-3"><span className="flex items-center gap-2 text-xs text-muted-foreground"><Volume2 size={14} /> Text-to-speech in Tutor</span><Switch checked={form.voice_enabled === "true"} onChange={(checked) => update("voice_enabled", String(checked))} /></div></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <span className="flex items-center gap-2 text-xs text-muted-foreground"><Palette size={14} /> Theme</span>
                {(["dark", "light"] as const).map((theme) => (
                  <button key={theme} onClick={() => update("theme", theme)} className={cn("rounded-lg border px-3 py-1.5 text-[11px] capitalize transition", form.theme === theme ? "border-primary/[0.45] bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/25")}>{theme}</button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">Accent</span>
                {accents.map((accent) => (
                  <button key={accent.id} onClick={() => update("accent", accent.id)} aria-label={accent.label} className={cn("h-6 w-6 rounded-full border-2 transition", form.accent === accent.id ? "scale-110 border-foreground" : "border-transparent opacity-70 hover:opacity-100")} style={{ backgroundColor: accent.color }} />
                ))}
              </div>
              <Button onClick={saveProfile} loading={savingProfile}><Save size={14} /> Save profile</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> AI provider</CardTitle><p className="mt-1 text-xs text-muted-foreground">Optional. Offline mode uses a local retrieval engine and clear scaffolds so the app works without any API key.</p></div>
              <Badge className={aiStatus?.configured ? "border-success/30 text-success" : ""}>{aiStatus?.configured ? "Configured" : "Offline"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Provider</label>
                  <Select value={provider} onChange={(event) => update("ai_provider", event.target.value)}>
                    <option value="offline">Offline (no AI API)</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai_compatible">OpenAI-compatible</option>
                    <option value="local">Local server (Ollama / LM Studio)</option>
                  </Select>
                </div>
                <div>
                  <label className="label">Embedding mode</label>
                  <Select value={form.embedding_provider} onChange={(event) => update("embedding_provider", event.target.value)}>
                    <option value="local">Local feature hashing</option>
                    <option value="remote">Remote embeddings</option>
                  </Select>
                </div>
              </div>

              {provider === "local" ? (
                <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2">
                  <div><label className="label">Local base URL</label><Input value={form.local_base_url} onChange={(event) => update("local_base_url", event.target.value)} placeholder="http://127.0.0.1:11434/v1" /></div>
                  <div><label className="label">Local model</label><Input value={form.local_model} onChange={(event) => update("local_model", event.target.value)} placeholder="llama3.1" /></div>
                  <p className="text-[10px] leading-4 text-muted-foreground sm:col-span-2">Start your local server first (for Ollama: <code className="rounded bg-muted px-1">ollama serve</code>) and ensure the model is pulled.</p>
                </div>
              ) : null}

              {usesRemote && provider !== "local" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label">Base URL</label><Input value={form.ai_base_url} onChange={(event) => update("ai_base_url", event.target.value)} placeholder="https://api.openai.com/v1" /></div>
                  <div><label className="label">Model</label><Input value={form.ai_model} onChange={(event) => update("ai_model", event.target.value)} placeholder="gpt-4o-mini" /></div>
                  <div>
                    <label className="label">API key</label>
                    <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={form.ai_api_key_set ? "•••••••• saved — enter to replace" : "sk-…"} autoComplete="off" />
                    <p className="mt-1 text-[10px] text-muted-foreground">Encrypted with a device-local key. Leave blank to keep the saved key.</p>
                  </div>
                  <div><label className="label">Embedding model</label><Input value={form.ai_embedding_model} onChange={(event) => update("ai_embedding_model", event.target.value)} placeholder="text-embedding-3-small" /></div>
                </div>
              ) : null}

              {provider === "local" || usesRemote ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label className="label">Temperature</label><Input type="number" min={0} max={2} step={0.1} value={form.ai_temperature} onChange={(event) => update("ai_temperature", event.target.value)} /></div>
                  <div><label className="label">Max tokens</label><Input type="number" min={128} max={8192} value={form.ai_max_tokens} onChange={(event) => update("ai_max_tokens", event.target.value)} /></div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => saveAI(false)} loading={savingAI}><Save size={14} /> Save AI settings</Button>
                <Button variant="outline" onClick={() => saveAI(true)} loading={testing} disabled={provider === "offline"}><Zap size={14} /> Save & test</Button>
              </div>

              {aiStatus ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-[10px] leading-5 text-muted-foreground">
                  <p className="flex items-center gap-1.5 font-medium text-foreground"><Brain size={12} className="text-primary" /> {aiStatus.provider} · {aiStatus.model || "no model"}</p>
                  <p className="mt-1">{aiStatus.message}</p>
                  <p className="mt-1">{aiStatus.ready_documents} documents · {aiStatus.indexed_chunks} indexed chunks · embeddings: {aiStatus.embedding_provider}</p>
                </div>
              ) : null}
              <p className="text-[10px] leading-4 text-muted-foreground">Your API key is encrypted at rest and never sent anywhere except the provider you configure. Answers are grounded in your documents when citations are available.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Database size={15} className="text-primary" /> Local data</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Download backup</p><p className="text-[10px] text-muted-foreground">Database + uploaded files as a .zip</p></div>
                <a href={api.backupUrl()} className="inline-flex"><Button variant="outline" size="sm"><Download size={13} /> Backup</Button></a>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Restore backup</p><p className="text-[10px] text-muted-foreground">Replaces current data after restart</p></div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={restoring}><Upload size={13} /> Restore</Button>
                <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) restore(file); }} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Re-index documents</p><p className="text-[10px] text-muted-foreground">Rebuild embeddings with the current provider</p></div>
                <Button variant="outline" size="sm" onClick={reindex} loading={reindexing}><RefreshCw size={13} /> Re-index</Button>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-[10px] leading-4 text-muted-foreground">
                <HardDrive size={13} className="mt-0.5 shrink-0" />
                Data lives in <code className="break-all">%LOCALAPPDATA%\AIEngineeringCompanion</code>. Uninstalling the app does not delete your study data.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Keyboard size={15} className="text-primary" /> Shortcuts</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 text-[11px]">
                {[["Ctrl + K", "Search topics and pages"], ["Ctrl + Enter", "Send a tutor message"], ["Esc", "Close dialogs and palettes"], ["1–10", "Jump to teaching phases"], ["Click card", "Reveal flashcard answer"]].map(([keys, action]) => (
                  <div key={keys} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{action}</span>
                    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px]">{keys}</kbd>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-start gap-3 p-4">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
              <div><p className="text-xs font-medium">AI Engineering Companion v1.0.0</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Local-first study workspace for engineering students. Runs offline, stores data on your device, and never auto-completes topics without evidence.</p><p className="mt-2 text-[10px] text-muted-foreground">MIT License</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
