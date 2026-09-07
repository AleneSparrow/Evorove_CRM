import { useEffect, useState, type FormEvent } from "react";
import { api, type SecurityAuditEvent, type SecuritySession, type SecurityStatus, type TwoFactorSetup } from "../api/client";
import { describeError } from "../auth/AuthContext";
import { Field, inputCls } from "./Shared";

export function AccountSecurityPanel({ token }: { token: string }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [audit, setAudit] = useState<SecurityAuditEvent[]>([]);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [nextStatus, nextSessions, nextAudit] = await Promise.all([
      api.getSecurityStatus(token), api.listSecuritySessions(token), api.listSecurityAudit(token),
    ]);
    setStatus(nextStatus); setSessions(nextSessions); setAudit(nextAudit);
  };
  useEffect(() => { refresh().catch((err) => setError(describeError(err))); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (work: () => Promise<void>, success: string) => {
    setError(null); setMessage(null);
    try { await work(); await refresh(); setMessage(success); } catch (err) { setError(describeError(err)); }
  };
  const changePassword = (event: FormEvent) => { event.preventDefault(); if (newPassword !== newPasswordConfirmation) { setError("Passwords do not match."); return; } void act(async () => {
    await api.changePassword(token, currentPassword, newPassword); setCurrentPassword(""); setNewPassword(""); setNewPasswordConfirmation("");
  }, "Password changed. Other sessions were signed out."); };
  const startSetup = () => void act(async () => { setSetup(await api.beginTwoFactorSetup(token, currentPassword)); setCurrentPassword(""); }, "Add this key to your authenticator, then enter its code.");
  const confirmSetup = (event: FormEvent) => { event.preventDefault(); if (!setup) return; void act(async () => {
    const result = await api.confirmTwoFactorSetup(token, code); setRecoveryCodes(result.codes); setSetup(null); setCode("");
  }, "Two-factor authentication is now enabled."); };
  const disable = () => void act(async () => { await api.disableTwoFactor(token, currentPassword, code); setCurrentPassword(""); setCode(""); }, "Two-factor authentication disabled.");
  const rotateCodes = () => void act(async () => { const result = await api.regenerateRecoveryCodes(token, currentPassword, code); setRecoveryCodes(result.codes); setCurrentPassword(""); setCode(""); }, "New recovery codes generated. Save them now.");

  return <section className="max-w-2xl space-y-7">
    <div><h2 className="text-lg font-semibold">Security</h2><p className="text-sm text-mute mt-1">Control access to your Evorove account. Secrets and recovery codes are never shown again after you leave this page.</p></div>
    {error && <p className="text-sm px-3 py-2 rounded bg-[#FBEBE9] text-[#B4483A]">{error}</p>}
    {message && <p className="text-sm px-3 py-2 rounded bg-[#E9F5EF] text-[#1E7B52]">{message}</p>}
    <form onSubmit={changePassword} className="border border-line rounded-xl p-5"><h3 className="font-semibold mb-4">Change password</h3><Field label="Current password"><input type="password" required className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field><Field label="New password"><input type="password" required minLength={12} className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field><Field label="Confirm new password"><input type="password" required minLength={12} className={inputCls} value={newPasswordConfirmation} onChange={(e) => setNewPasswordConfirmation(e.target.value)} /></Field><button className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: "#0B0B0D" }}>Change password</button></form>
    <div className="border border-line rounded-xl p-5"><h3 className="font-semibold">Two-factor authentication</h3><p className="text-sm text-mute mt-1 mb-4">{status?.two_factor_enabled ? `Enabled · ${status.recovery_codes_remaining} recovery codes remaining` : "Not enabled"}</p>{!status?.two_factor_enabled && !setup && <div className="grid gap-3"><Field label="Current password"><input type="password" required className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field><button onClick={startSetup} className="justify-self-start px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: "#0B0B0D" }}>Set up authenticator app</button></div>}{setup && <form onSubmit={confirmSetup} className="mt-4"><p className="text-sm mb-2">Add this one-time key in Google Authenticator, 1Password, Authy, or another TOTP app:</p><code className="block break-all text-xs bg-cream p-3 rounded">{setup.secret}</code><p className="text-xs text-mute mt-2">Or use this provisioning URI in a compatible app: {setup.provisioning_uri}</p><Field label="Six-digit code"><input required className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} /></Field><button className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: "#0B0B0D" }}>Confirm two-factor authentication</button></form>}{status?.two_factor_enabled && <div className="mt-4 grid gap-3"><Field label="Current password"><input type="password" className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field><Field label="Authenticator or recovery code"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} /></Field><div className="flex gap-2"><button onClick={rotateCodes} className="px-3 py-2 rounded-lg text-sm border border-[#D8D4CB]">Generate new recovery codes</button><button onClick={disable} className="px-3 py-2 rounded-lg text-sm text-[#B4483A] border border-[#E7C6C1]">Disable 2FA</button></div></div>}</div>
    {recoveryCodes && <div className="border border-[#D8B27A] bg-[#FFF8EE] rounded-xl p-5"><h3 className="font-semibold">Save your recovery codes</h3><p className="text-sm text-mute my-2">Each code works once. They will not be shown again.</p><pre className="text-sm whitespace-pre-wrap">{recoveryCodes.join("\n")}</pre><button onClick={() => setRecoveryCodes(null)} className="mt-3 px-3 py-2 rounded-lg text-sm border border-[#D8D4CB]">I saved these codes</button></div>}
    <div className="border border-line rounded-xl p-5"><div className="flex items-center justify-between"><h3 className="font-semibold">Active sessions</h3><button onClick={() => void act(async () => { await api.revokeOtherSecuritySessions(token); }, "Other sessions signed out.")} className="text-sm font-medium" style={{ color: "#FF5A36" }}>Sign out other sessions</button></div><div className="mt-3 space-y-2">{sessions.map((session) => <div key={session.session_id} className="flex justify-between gap-3 text-sm"><span>{session.current ? "Current session" : session.revoked_at ? "Signed out session" : "Active session"} · {new Date(session.created_at).toLocaleString()}</span>{!session.current && !session.revoked_at && <button onClick={() => void act(() => api.revokeSecuritySession(token, session.session_id), "Session signed out.")} className="text-[#B4483A]">Sign out</button>}</div>)}</div></div>
    <div className="border border-line rounded-xl p-5"><h3 className="font-semibold">Security history</h3><div className="mt-3 space-y-2 text-sm">{audit.length ? audit.map((event) => <div key={event.event_id} className="flex justify-between gap-3"><span>{event.event_type.replace(/_/g, " ")}</span><span className="text-mute">{new Date(event.created_at).toLocaleString()}</span></div>) : <p className="text-mute">No security events yet.</p>}</div></div>
  </section>;
}
