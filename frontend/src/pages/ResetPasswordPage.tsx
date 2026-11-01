import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      toast("Passwords do not match", "Re-enter the same new password in both fields.", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await api.confirmPasswordReset(token, password);
      setDone(true);
      toast("Password updated", result.message, "success");
    } catch (err) {
      toast("Reset failed", err instanceof ApiError ? err.message : "Unexpected error", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border-border/80 bg-card/80 backdrop-blur-xl">
        <CardContent className="p-7">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><KeyRound size={20} /></div>
          <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
          {!token ? (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">This reset link is missing its token. Request a new link from the sign-in screen.</p>
              <Link to="/"><Button className="mt-5 w-full" variant="outline"><ArrowLeft size={14} /> Back to sign in</Button></Link>
            </>
          ) : done ? (
            <>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Your password was changed and all other sessions were signed out.</p>
              <Link to="/"><Button className="mt-5 w-full">Sign in with your new password</Button></Link>
            </>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">Use at least 8 characters. Avoid reusing a password from another site.</p>
              <div>
                <label className="label">New password</label>
                <div className="relative"><LockKeyhole size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div>
              </div>
              <div>
                <label className="label">Confirm password</label>
                <div className="relative"><ShieldCheck size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" type="password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></div>
              </div>
              <Button type="submit" className="w-full" loading={busy}>Update password</Button>
              <Link to="/" className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary"><ArrowLeft size={12} /> Back to sign in</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
