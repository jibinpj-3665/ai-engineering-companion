import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Brain, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles, User } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { safeInternalPath } from "../lib/navigation";
import { useApp } from "../contexts/AppContext";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../components/ui/Toast";

export function AuthPage() {
  const { auth, authRequired, registrationAllowed, smtpConfigured, login, register, error } = useApp();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const redirect = safeInternalPath(params.get("next"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      if (tab === "register") {
        await register(name || "Engineer", email, password);
      } else {
        await login(email, password);
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : "Could not sign in. Check the backend connection.");
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetBusy(true);
    try {
      const result = await api.requestPasswordReset(resetEmail);
      toast("Reset requested", result.message, "success");
      setResetMode(false);
    } catch (err) {
      toast("Could not request reset", err instanceof ApiError ? err.message : "Unexpected error", "error");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute -left-40 top-0 h-[520px] w-[520px] rounded-full bg-primary/[0.10] blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-accent-2/[0.10] blur-3xl" />
      <div className="relative grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden flex-col justify-between rounded-3xl border border-border/70 bg-card/40 p-8 backdrop-blur-xl lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] shadow-glow">
                <Sparkles size={21} className="text-white" />
              </span>
              <div>
                <p className="font-display text-lg font-semibold leading-tight">AI Engineering Companion</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Learn deeper · build better</p>
              </div>
            </div>
            <h1 className="mt-10 max-w-md font-display text-3xl font-semibold leading-tight">Your notes, your progress, your own account.</h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
              A private engineering study workspace with grounded AI tutoring, document retrieval, spaced revision and
              evidence-based mastery. Each account keeps its own subjects, documents and conversations.
            </p>
            <div className="mt-8 space-y-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-2"><ShieldCheck size={14} className="text-success" /> Session cookies are HTTP-only; passwords use scrypt.</p>
              <p className="flex items-center gap-2"><Brain size={14} className="text-primary" /> AI answers cite your uploaded material.</p>
              <p className="flex items-center gap-2"><LockKeyhole size={14} className="text-accent-2" /> Backup exports only your own account.</p>
            </div>
          </div>
          <Badge className="w-fit"><ShieldCheck size={11} /> {authRequired ? "Secure multi-user server" : "Local desktop workspace"}</Badge>
        </div>

        <Card className="border-border/80 bg-card/80 backdrop-blur-xl">
          <CardContent className="p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))]">
                <Sparkles size={18} className="text-white" />
              </span>
              <p className="font-display text-base font-semibold">AI Engineering Companion</p>
            </div>

            {resetMode ? (
              <form onSubmit={requestReset} className="space-y-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Password reset</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">Recover your account</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your account email. A one-time link is sent if the account exists.</p>
                </div>
                {!smtpConfigured ? (
                  <p className="rounded-xl border border-warning/25 bg-warning/[0.08] p-3 text-[11px] leading-5 text-warning">
                    This server has no SMTP configured, so reset email cannot be sent. Ask the administrator to configure SMTP.
                  </p>
                ) : null}
                <div><label className="label">Email</label><Input type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></div>
                <Button type="submit" className="w-full" loading={resetBusy} disabled={!smtpConfigured}><Mail size={14} /> Send reset link</Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setResetMode(false)}>Back to sign in</Button>
              </form>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="flex rounded-xl border border-border bg-muted/30 p-1">
                  <button type="button" onClick={() => setTab("login")} className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${tab === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Sign in</button>
                  <button type="button" onClick={() => setTab("register")} disabled={!registrationAllowed} className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition disabled:opacity-40 ${tab === "register" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Create account</button>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{tab === "login" ? "Welcome back" : "Start studying"}</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">{tab === "login" ? "Sign in to your workspace" : "Create your account"}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {tab === "login" ? "Your subjects, notes and tutor history stay private to this account." : registrationAllowed ? "One account per student. Your data is isolated from every other account." : "Registration is closed on this server."}
                  </p>
                </div>

                {tab === "register" ? (
                  <div><label className="label">Name</label><div className="relative"><User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" /></div></div>
                ) : null}
                <div><label className="label">Email</label><div className="relative"><Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com" /></div></div>
                <div>
                  <label className="label">Password</label>
                  <div className="relative"><LockKeyhole size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={tab === "login" ? "current-password" : "new-password"} placeholder={tab === "login" ? "Your password" : "At least 8 characters"} /></div>
                </div>

                {localError || error ? (
                  <p className="rounded-xl border border-danger/25 bg-danger/[0.08] p-3 text-[11px] leading-5 text-danger">{localError || error}</p>
                ) : null}

                <Button type="submit" className="w-full" loading={busy} disabled={tab === "register" && !registrationAllowed}>
                  {tab === "login" ? "Sign in" : "Create account"} <ArrowRight size={14} />
                </Button>

                {tab === "login" ? (
                  <button type="button" onClick={() => { setResetEmail(email); setResetMode(true); }} className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-primary">
                    <KeyRound size={12} /> Forgot password?
                  </button>
                ) : null}
              </form>
            )}

            <p className="mt-6 text-center text-[10px] leading-5 text-muted-foreground">
              {auth?.registration_allowed ? "New accounts are enabled on this server." : "Only existing accounts can sign in."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
