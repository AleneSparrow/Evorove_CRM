import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth, describeError } from "../auth/AuthContext";
import { Field, inputCls } from "../components/Shared";
import { AuthShell } from "../brand/AuthShell";

export default function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!agreed) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }
    if (password.length < 8) {
      setError("Password needs to be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await signup(email.trim(), password);
      navigate("/onboarding");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-line p-7">
        <h1 className="ev-display text-5xl mb-2">Create your account</h1>
        <p className="text-sm text-mute mb-6">Sets up your login. You'll build your Business DNA next.</p>
        <form onSubmit={handleSubmit}>
          <Field label="Work email">
            <input type="email" required autoFocus className={inputCls} placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <input type="password" required minLength={8} className={inputCls} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password">
            <input type="password" required className={inputCls} placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2.5 mb-5 text-sm text-mute leading-relaxed">
            <input
              type="checkbox"
              required
              className="mt-1 shrink-0"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I agree to the{" "}
              <Link to="/terms" target="_blank" rel="noreferrer" className="font-medium" style={{ color: "#FF5A36" }}>
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" target="_blank" rel="noreferrer" className="font-medium" style={{ color: "#FF5A36" }}>
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {error && <div className="mb-4 text-sm px-3.5 py-2.5 rounded-lg" style={{ color: "#B4483A", backgroundColor: "#FBEBE9" }}>{error}</div>}
          <button type="submit" disabled={submitting || !agreed} className="w-full text-sm font-medium px-5 py-2.5 rounded-full flex items-center justify-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: "#0B0B0D", color: "#F7F1E4" }}>
            {submitting ? "Creating account…" : "Create account"} <ArrowRight size={14} />
          </button>
        </form>
      </div>
      <p className="text-sm text-mute text-center mt-5">
        Already have an account?{" "}
        <Link to="/login" className="font-medium" style={{ color: "#FF5A36" }}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
