import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Keyboard,
  ListChecks,
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
import type {
  AITestResult,
  AIUsageResponse,
  ModelList,
  ProviderPreset,
  Settings as SettingsType,
} from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input, Select, Textarea } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Switch } from "../components/ui/Switch";
import { Spinner } from "../components/ui/Spinner";
import { AccountCard } from "../components/AccountCard";
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
  const { settings, setSettings, aiStatus, refreshAIStatus, loading, user, authRequired, envKeysOnly } = useApp();
  const { toast } = useToast();
  const [form, setForm] = useState<SettingsType | null>(settings);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [models, setModels] = useState<ModelList | null>(null);
  const [usage, setUsage] = useState<AIUsageResponse | null>(null);
  const [savingAI, setSavingAI] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AITestResult | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (settings) setForm(settings); }, [settings]);

  useEffect(() => {
    api.aiProviders().then((data) => setProviders(data.providers)).catch(() => setProviders([]));
    api.aiUsage(20).then(setUsage).catch(() => setUsage(null));
  }, []);

  if (loading || !form) return <div className="py-24"><Spinner label="Loading preferences" /></div>;

  const update = (key: keyof SettingsType, value: string) => setForm((current) => current ? { ...current, [key]: value } : current);

  const applyProvider = (id: string) => {
    const preset = providers.find((item) => item.id === id);
    const supportsRemote = preset?.supports_remote_embeddings ?? !["offline", "groq"].includes(id);
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, ai_provider: id };
      if (preset) {
        if (id === "local") {
          next.local_base_url = preset.base_url || current.local_base_url;
          next.local_model = preset.model || current.local_model;
        } else if (id !== "offline") {
          next.ai_base_url = preset.base_url;
          next.ai_model = preset.model;
        }
      }
      if (!supportsRemote) {
        next.embedding_provider = "local";
      } else if (current.embedding_provider === "remote" && preset?.embedding_model) {
        next.ai_embedding_model = preset.embedding_model;
      }
      return next;
    });
    setModels(null);
    setTestResult(null);
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const list = await api.aiModels({
        provider: form.ai_provider,
        base_url: form.ai_provider === "local" ? form.local_base_url : form.ai_base_url,
        api_key: apiKey.trim() || undefined,
        embedding_provider: form.embedding_provider,
      });
      setModels(list);
      if (list.chat_models.length === 0 && list.embedding_models.length === 0) {
        toast("No models returned", list.message || "The provider did not list any models.", "warning");
      } else {
        toast(
          "Models loaded",
          `${list.chat_models.length} chat and ${list.embedding_models.length} embedding model${list.embedding_models.length === 1 ? "" : "s"} returned by ${list.provider}.`,
          "success",
        );
      }
    } catch (error) {
      toast("Could not load models", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoadingModels(false);
    }
  };

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
      setForm(updated);
      setTestResult(null);
      await refreshAIStatus();
      api.aiProviders().then((data) => setProviders(data.providers)).catch(() => undefined);
      api.aiUsage(20).then(setUsage).catch(() => undefined);
      toast(
        "AI settings saved",
        updated.ai_configured
          ? "Configuration validated. Run the chat and embedding tests to verify the provider."
          : "Saved. Add the missing fields to activate the provider.",
        "success",
      );
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
      setTestResult(result);
      toast(result.ok ? "AI tests passed" : "AI tests need attention", result.message, result.ok ? "success" : "error");
    } catch (error) {
      setTestResult(null);
      toast("AI tests failed", error instanceof ApiError ? error.message : "Unexpected error", "error");
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
  const providerOptions: ProviderPreset[] = providers.length ? providers : [
    { id: "offline", label: "Offline retrieval only", base_url: "", model: "", embedding_model: "", supports_remote_embeddings: false, requires_key: false, note: "", env_key_set: false, selected: provider === "offline" },
    { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", embedding_model: "text-embedding-3-small", supports_remote_embeddings: true, requires_key: true, note: "", env_key_set: false, selected: provider === "openai" },
    { id: "gemini", label: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.6-flash", embedding_model: "gemini-embedding-2", supports_remote_embeddings: true, requires_key: true, note: "", env_key_set: false, selected: provider === "gemini" },
    { id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", embedding_model: "", supports_remote_embeddings: false, requires_key: true, note: "", env_key_set: false, selected: provider === "groq" },
    { id: "local", label: "Ollama / local server", base_url: "http://127.0.0.1:11434/v1", model: "llama3.1", embedding_model: "text-embedding-3-small", supports_remote_embeddings: true, requires_key: false, note: "", env_key_set: false, selected: provider === "local" },
    { id: "custom", label: "Custom OpenAI-compatible", base_url: "", model: "", embedding_model: "text-embedding-3-small", supports_remote_embeddings: true, requires_key: false, note: "", env_key_set: false, selected: provider === "custom" },
  ];
  const selectedPreset = providerOptions.find((item) => item.id === provider);
  const supportsRemoteEmbeddings = selectedPreset?.supports_remote_embeddings ?? !["offline", "groq"].includes(provider);
  const envKeyActive = Boolean(selectedPreset?.env_key_set || form.key_source === "environment");
  const chatModelOptions = Array.from(new Set([
    ...(models?.chat_models.map((item) => item.id) ?? []),
    form.ai_model,
  ].filter(Boolean)));
  const embeddingModelOptions = Array.from(new Set([
    ...(models?.embedding_models.map((item) => item.id) ?? []),
    form.ai_embedding_model,
  ].filter(Boolean)));

  const updateEmbeddingMode = (mode: "local" | "remote") => {
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, embedding_provider: mode };
      if (mode === "remote" && selectedPreset?.embedding_model) next.ai_embedding_model = selectedPreset.embedding_model;
      return next;
    });
    setTestResult(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle={authRequired ? "Your profile, appearance, AI provider and account data." : "Your profile, appearance, AI provider and local data."} actions={<Badge><ShieldCheck size={11} /> {authRequired ? "Account secured" : "Local-first"}</Badge>} />

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
              <Badge className={testResult?.ok || aiStatus?.configured ? "border-success/30 text-success" : ""}>{testResult?.ok ? "Verified this session" : aiStatus?.configured ? "Configured" : "Offline"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Provider</label>
                  <Select value={provider} onChange={(event) => applyProvider(event.target.value)}>
                    {providerOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </Select>
                  {selectedPreset?.note ? <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{selectedPreset.note}</p> : null}
                </div>
                <div>
                  <label className="label">Embedding mode</label>
                  <Select value={form.embedding_provider} onChange={(event) => updateEmbeddingMode(event.target.value as "local" | "remote")}>
                    <option value="local">Local feature hashing (384 dimensions)</option>
                    <option value="remote" disabled={!supportsRemoteEmbeddings}>
                      Remote embeddings via {selectedPreset?.label || provider}
                    </option>
                  </Select>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    {supportsRemoteEmbeddings
                      ? "Remote embeddings use the same provider credentials and require a re-index after changing models."
                      : "This provider does not expose remote embeddings here; local embeddings remain available."}
                  </p>
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
                  <div>
                    <label className="label">Chat model</label>
                    <div className="flex gap-2">
                      <Select value={form.ai_model} onChange={(event) => update("ai_model", event.target.value)}>
                        {chatModelOptions.length ? chatModelOptions.map((id) => <option key={id} value={id}>{id}</option>) : <option value={form.ai_model}>{form.ai_model || "Load models first"}</option>}
                      </Select>
                      <Button type="button" variant="outline" size="sm" onClick={fetchModels} loading={loadingModels} aria-label="Load available models"><RefreshCw size={13} /></Button>
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Exact model ID from the provider catalogue, not a guessed alias.</p>
                  </div>
                  <div>
                    <label className="label">API key</label>
                    <div className="flex gap-2">
                      <Input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={envKeysOnly} placeholder={envKeysOnly ? "Managed by server environment" : form.ai_api_key_set || envKeyActive ? "Saved - enter a new key to replace" : "sk-..."} autoComplete="off" />
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowKey((current) => !current)} disabled={envKeysOnly} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</Button>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">{envKeysOnly || envKeyActive ? "This server supplies the key from environment variables, so stored account keys are not used." : "Encrypted in your account. Leave blank to keep the saved key."}</p>
                  </div>
                </div>
              ) : null}

              {usesRemote && form.embedding_provider === "remote" ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div>
                      <label className="label">Embedding model</label>
                      <Select value={form.ai_embedding_model} onChange={(event) => update("ai_embedding_model", event.target.value)}>
                        {embeddingModelOptions.length ? embeddingModelOptions.map((id) => <option key={id} value={id}>{id}</option>) : <option value={form.ai_embedding_model}>{form.ai_embedding_model || "Load models first"}</option>}
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={fetchModels} loading={loadingModels}><RefreshCw size={13} /> Load models</Button>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    Vectors are forced to {form.embedding_dimensions || 384} dimensions for this index. Changing this model requires re-indexing before semantic retrieval can use it.
                  </p>
                  {models?.message ? <p className="mt-1 text-[10px] text-warning">{models.message}</p> : null}
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

              {testResult ? (
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 text-[10px] leading-4">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    <Zap size={12} className="text-primary" /> Latest test results
                    <Badge className={testResult.ok ? "border-success/30 text-success" : "border-warning/30 text-warning"}>{testResult.ok ? "Passed" : "Action needed"}</Badge>
                  </p>
                  {([
                    ["Chat", testResult.chat],
                    ["Embeddings", testResult.embedding],
                  ] as const).map(([label, part]) => (
                    <div key={label} className="rounded-lg border border-border/60 bg-background/30 px-2.5 py-2">
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        {part.ok ? <CheckCircle2 size={11} className="text-success" /> : <AlertTriangle size={11} className="text-warning" />}
                        {label}: {part.ok ? (part.skipped ? "Skipped" : "Passed") : "Failed"}
                        {part.dimensions ? <span className="font-normal text-muted-foreground">({part.dimensions} dims)</span> : null}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">{part.message}</p>
                      {part.signature ? <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{part.signature}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {aiStatus ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-[10px] leading-5 text-muted-foreground">
                  <p className="flex items-center gap-1.5 font-medium text-foreground"><Brain size={12} className="text-primary" /> {aiStatus.provider} · {aiStatus.model || "no model"}</p>
                  <p className="mt-1">{aiStatus.message}</p>
                  <p className="mt-1">{aiStatus.ready_documents} documents · {aiStatus.indexed_chunks} indexed chunks · embeddings: {aiStatus.embedding_provider}{aiStatus.embedding_model ? ` / ${aiStatus.embedding_model}` : ""}</p>
                  {aiStatus.embedding_index ? (
                    <p className="mt-1">
                      Index: {aiStatus.embedding_index.matching_chunks}/{aiStatus.embedding_index.total_chunks} chunks match the current embedding model.
                      {aiStatus.needs_reindex ? <span className="text-warning"> Re-index required; mismatched chunks are excluded from vector search.</span> : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[10px] leading-4 text-muted-foreground">Your API key is encrypted at rest and never sent anywhere except the provider you configure. Answers are grounded in your documents when citations are available.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-5">
          <AccountCard />

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks size={15} className="text-primary" /> AI usage</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {usage ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Requests</p><p className="mt-1 font-display text-xl font-semibold">{usage.summary.requests}</p></div>
                    <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Errors</p><p className={cn("mt-1 font-display text-xl font-semibold", usage.summary.errors > 0 && "text-warning")}>{usage.summary.errors}</p></div>
                  </div>
                  {usage.logs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No AI requests recorded yet.</p>
                  ) : (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {usage.logs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[10px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{log.operation} ? {log.model || log.provider}</p>
                            <p className="text-muted-foreground">{new Date(log.created_at).toLocaleString()} ? {log.input_chars + log.output_chars} chars</p>
                          </div>
                          <div className="text-right">
                            <span className={cn("rounded px-1.5 py-0.5", log.status === "ok" ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>{log.status}</span>
                            <p className="mt-0.5 text-muted-foreground">{log.latency_ms} ms</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] leading-4 text-muted-foreground">Only metadata is logged: provider, model, operation, size and latency. Prompts and answers are not stored in this log.</p>
                </>
              ) : <p className="text-[11px] text-muted-foreground">Usage log is unavailable.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Database size={15} className="text-primary" /> Workspace data</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Download backup</p><p className="text-[10px] text-muted-foreground">Your account data + files as a .zip; credentials excluded</p></div>
                <a href={api.backupUrl()} className="inline-flex"><Button variant="outline" size="sm"><Download size={13} /> Backup</Button></a>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Restore backup</p><p className="text-[10px] text-muted-foreground">Replaces only your account data</p></div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={restoring}><Upload size={13} /> Restore</Button>
                <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) restore(file); }} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
                <div><p className="text-xs font-medium">Re-index documents</p><p className="text-[10px] text-muted-foreground">Rebuild embeddings with the current provider</p></div>
                <Button variant="outline" size="sm" onClick={reindex} loading={reindexing}><RefreshCw size={13} /> Re-index</Button>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-[10px] leading-4 text-muted-foreground">
                <HardDrive size={13} className="mt-0.5 shrink-0" />
                Desktop data lives in <code className="break-all">%LOCALAPPDATA%\AIEngineeringCompanion</code>. On a server, the administrator controls storage and backups. Exports never include AI credentials.
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
              <div><p className="text-xs font-medium">AI Engineering Companion v1.3.0</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Private engineering study workspace with accounts, grounded AI tutoring and evidence-based mastery. Offline retrieval stays available without a provider.</p><p className="mt-2 text-[10px] text-muted-foreground">MIT License</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
