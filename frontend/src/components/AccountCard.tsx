import { useState } from "react";
import { LogOut, Mail, ShieldCheck, UserRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";

export function AccountCard() {
  const { user, authRequired, smtpConfigured, envKeysOnly, refreshAuth, logout } = useApp();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserRound size={15} className="text-primary" /> Account</CardTitle></CardHeader>
        <CardContent><p className="text-xs leading-5 text-muted-foreground">This backend is running in local single-user mode. No sign-in is required.</p></CardContent>
      </Card>
    );
  }

  const saveName = async () => {
    setSavingName(true);
    try {
      const updated = await api.updateProfile(name.trim() || user.name);
      setName(updated.name);
      await refreshAuth();
      toast("Account updated", "Your display name was saved.", "success");
    } catch (err) {
      toast("Could not update account", err instanceof ApiError ? err.message : "Unexpected error", "error");
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast("Passwords do not match", "Re-enter the same new password in both fields.", "error");
      return;
    }
    setSavingPassword(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("Password changed", result.message, "success");
    } catch (err) {
      toast("Could not change password", err instanceof ApiError ? err.message : "Unexpected error", "error");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><UserRound size={15} className="text-primary" /> Account</CardTitle>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Mail size={11} /> {user.email}</p>
        </div>
        <Badge className="border-success/25 text-success"><ShieldCheck size={10} /> {authRequired ? "Protected" : "Local"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {envKeysOnly ? (
          <p className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-[10px] leading-5 text-primary">
            This server reads AI keys from environment variables only. Keys saved in the browser are ignored by policy.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div><label className="label">Display name</label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <Button className="self-end" variant="outline" onClick={saveName} loading={savingName}>Save name</Button>
        </div>
        <div className="border-t border-border/60 pt-4">
          <p className="text-xs font-medium">Change password</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {user.is_local ? null : <div><label className="label">Current</label><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></div>}
            <div><label className="label">New password</label><Input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></div>
            <div><label className="label">Confirm</label><Input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={savePassword} loading={savingPassword} disabled={newPassword.length < 8}>Update password</Button>
            {!smtpConfigured ? <span className="text-[10px] text-muted-foreground">Password reset email is not configured on this server.</span> : null}
          </div>
        </div>
        {authRequired ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="text-[10px] leading-4 text-muted-foreground">Signing out clears this browser session. Your study data stays on the server.</p>
            <Button size="sm" variant="danger" onClick={() => logout()}><LogOut size={13} /> Sign out</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
