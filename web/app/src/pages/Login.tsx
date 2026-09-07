import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth, describeError } from "../auth/AuthContext";
import { Field, inputCls } from "../components/Shared";
import { AuthShell } from "../brand/AuthShell";
import { PRODUCT_NAME } from "../brand/theme";

export default function Login() {
  const navigate = useNavigate();
  const { login, completeTwoFactorLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if ("two_factor_required" in result) {
        setChallenge(result.challenge_token);
        return;
      }
      const user = result;
      navigate(user.business_ids.length > 0 ? "/app" : "/onboarding");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTwoFactor(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await completeTwoFactorLogin(challenge, twoFactorCode);
      navigate(user.business_ids.length > 0 ? "/app" : "/onboarding");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-line p-7">
        <h1 className="ev-display text-5xl mb-2">Sign in</h1>
        <p className="text-sm text-mute mb-6">Welcome back — your engine kept working while you were away.</p>

        {!challenge ? (
          <form onSubmit={handleSubmit}>
            <Field label="Work email">
              <input type="email" required autoFocus className={inputCls} placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input type="password" required className={inputCls} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div className="-mt-2 mb-5 text-right">
              <Link to="/forgot-password" className="text-xs font-medium" style={{ color: "#FF5A36" }}>Forgot password?</Link>
            </div>
            {error && <div className="mb-4 text-sm px-3.5 py-2.5 rounded-lg" style={{ color: "#B4483A", backgroundColor: "#FBEBE9" }}>{error}</div>}
            <button type="submit" disabled={submitting} className="w-full text-sm font-medium px-5 py-2.5 rounded-full flex items-center justify-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: "#0B0B0D", color: "#F7F1E4" }}>
              {submitting ? "Signing in…" : "Sign in"} <ArrowRight size={14} />
            </button>
          </form>
        ) : (
          <form onSubmit={handleTwoFactor}>
            <p className="text-sm text-mute mb-5">Enter the six-digit code from your authenticator app, or a recovery code.</p>
            <Field label="Authenticator or recovery code">
              <input type="text" required autoFocus className={inputCls} value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} autoComplete="one-time-code" />
            </Field>
            {error && <div className="mb-4 text-sm px-3.5 py-2.5 rounded-lg" style={{ color: "#B4483A", backgroundColor: "#FBEBE9" }}>{error}</div>}
            <button type="submit" disabled={submitting} className="w-full text-sm font-medium px-5 py-2.5 rounded-full disabled:opacity-60" style={{ backgroundColor: "#0B0B0D", color: "#F7F1E4" }}>
              {submitting ? "Verifying…" : "Verify and sign in"}
            </button>
          </form>
        )}
      </div>
      <p className="text-sm text-mute text-center mt-5">
        New to {PRODUCT_NAME}?{" "}
        <Link to="/signup" className="font-medium" style={{ color: "#FF5A36" }}>Create an account</Link>
      </p>
    </AuthShell>
  );
}
