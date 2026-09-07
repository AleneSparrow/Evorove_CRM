import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Field, inputCls } from "../components/Shared";
import { AuthShell } from "../brand/AuthShell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.forgotPassword(email.trim());
    } finally {
      setSubmitted(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="bg-white rounded-2xl border border-line p-7">
        <h1 className="ev-display text-5xl mb-2">Reset your password</h1>
        {submitted ? (
          <>
            <p className="text-sm text-mute mb-6">If an account matches that email, a reset link will arrive shortly.</p>
            <Link to="/login" className="text-sm font-medium" style={{ color: "#FF5A36" }}>Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="text-sm text-mute mb-6">Enter your work email. We’ll send a one-time reset link if it matches an account.</p>
            <Field label="Work email">
              <input type="email" required autoFocus className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <button type="submit" disabled={submitting} className="w-full text-sm font-medium px-5 py-2.5 rounded-full disabled:opacity-60" style={{ backgroundColor: "#0B0B0D", color: "#F7F1E4" }}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
