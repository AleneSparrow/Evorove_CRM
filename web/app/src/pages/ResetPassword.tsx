import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { Field, inputCls } from "../components/Shared";
import { AuthShell } from "../brand/AuthShell";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) setError("This reset link is invalid or has expired.");
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setSubmitting(true); setError(null);
    try {
      await api.resetPassword(token, password);
      setParams({}, { replace: true });
      navigate("/login", { replace: true });
    } catch (err) {
      setParams({}, { replace: true });
      setError(err instanceof ApiError ? "This reset link is invalid or has expired." : "Couldn’t reset your password.");
    } finally { setSubmitting(false); }
  }

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-line p-7">
        <h1 className="ev-display text-5xl mb-2">Choose a new password</h1>
        <p className="text-sm text-mute mb-6">This link can be used once. Other signed-in sessions will be ended.</p>
        {token ? (
          <form onSubmit={submit}>
            <Field label="New password"><input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Confirm password"><input type="password" required className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            {error && <p className="text-sm text-[#B4483A] mb-4">{error}</p>}
            <button disabled={submitting} className="w-full text-sm font-medium px-5 py-2.5 rounded-full disabled:opacity-60" style={{ backgroundColor: "#0B0B0D", color: "#F7F1E4" }}>{submitting ? "Saving…" : "Set new password"}</button>
          </form>
        ) : (
          <Link to="/forgot-password" className="text-sm font-medium" style={{ color: "#FF5A36" }}>Request a new link</Link>
        )}
      </div>
    </AuthShell>
  );
}
