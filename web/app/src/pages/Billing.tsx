import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { useAuth, describeError } from "../auth/AuthContext";
import { api, type BillingPlan, type BillingStatus } from "../api/client";

const PLANS: { id: BillingPlan; name: string; price: string; desc: string; features: string[] }[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$199/mo",
    desc: "For a single owner-operated business getting its first automated leads live.",
    features: ["Full lead-to-sale automation", "Unlimited conversations", "Email support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$499/mo",
    desc: "For a growing team that wants priority support as volume ramps up.",
    features: ["Everything in Starter", "Priority support", "Early access to new features"],
  },
];

/** True once the business needs to start a fresh Checkout rather than manage
 * an existing subscription via the Customer Portal -- either it never
 * checked out, or a previous subscription is fully `expired` (Lemon Squeezy
 * doesn't let an expired subscription be revived through the Portal; a new
 * Checkout is required). Deliberately excludes `cancelled` -- that status
 * still has billing access and a real subscription to manage, see
 * ACTIVE_SUBSCRIPTION_STATUSES in src/domain/tenancy.py. */
function needsPlanSelection(status: BillingStatus): boolean {
  return status.subscription_status === "incomplete" || status.subscription_status === "expired";
}

// on_trial uses Pulse coral: the subscription is in motion. Lime stays on
// human/CTA states; a running trial is a product state, not a "needs you".
const STATUS_COPY: Record<BillingStatus["subscription_status"], { label: string; color: string; bg: string }> = {
  incomplete: { label: "No subscription yet", color: "#6B6459", bg: "#F1F1EF" },
  on_trial: { label: "Free trial", color: "#FF5A36", bg: "#FFE8E1" },
  active: { label: "Active", color: "#1E7B52", bg: "#E9F5EF" },
  paused: { label: "Paused", color: "#6B6459", bg: "#F1F1EF" },
  past_due: { label: "Payment failed", color: "#C73618", bg: "#FFE8E1" },
  unpaid: { label: "Payment failed", color: "#C73618", bg: "#FFE8E1" },
  cancelled: { label: "Cancelled", color: "#B4483A", bg: "#FBEBE9" },
  expired: { label: "Expired", color: "#B4483A", bg: "#FBEBE9" },
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function Billing() {
  const { token, businessId } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<BillingPlan | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const checkoutResult = searchParams.get("checkout"); // "success" | null

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    setLoading(true);
    setLoadError(null);
    api
      .getBillingStatus(token, businessId)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-check right after returning from Checkout so a completed trial shows
    // up immediately rather than waiting on the next page load -- the webhook
    // that actually flips the status usually lands within a few seconds.
  }, [token, businessId, checkoutResult]);

  const startCheckout = async (plan: BillingPlan) => {
    if (!token || !businessId) return;
    setPendingPlan(plan);
    setActionError(null);
    try {
      const { checkout_url } = await api.createCheckoutSession(token, businessId, plan);
      window.location.href = checkout_url;
    } catch (err) {
      setActionError(describeError(err));
      setPendingPlan(null);
    }
  };

  const openPortal = async () => {
    if (!token || !businessId) return;
    setOpeningPortal(true);
    setActionError(null);
    try {
      const { portal_url } = await api.createPortalSession(token, businessId);
      window.location.href = portal_url;
    } catch (err) {
      setActionError(describeError(err));
      setOpeningPortal(false);
    }
  };

  return (
    <div className="ev-page min-h-screen w-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">
        <header className="px-6 md:px-8 py-4 border-b border-line">
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-mute mt-0.5">Your Evorove subscription — manage it yourself, any time.</p>
        </header>

        <div className="flex-1 px-6 md:px-8 py-8 max-w-3xl w-full">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-mute py-16 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}

          {!loading && loadError && (
            <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
              {loadError}
            </div>
          )}

          {!loading && !loadError && status && (
            <>
              {actionError && (
                <div className="mb-6 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
                  {actionError}
                </div>
              )}

              {!needsPlanSelection(status) && (
                <div className="bg-white rounded-2xl border border-line p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-sm text-mute mb-1">Current plan</div>
                      <div className="text-lg font-semibold capitalize">{status.plan ?? "—"}</div>
                    </div>
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{ color: STATUS_COPY[status.subscription_status].color, backgroundColor: STATUS_COPY[status.subscription_status].bg }}
                  >
                      {status.subscription_status === "active" && <Check size={12} />}
                      {(status.subscription_status === "past_due" || status.subscription_status === "unpaid") && <AlertTriangle size={12} />}
                      {STATUS_COPY[status.subscription_status].label}
                    </span>
                  </div>

                  {status.subscription_status === "on_trial" && status.trial_ends_at && (
                    <p className="text-sm text-mute mb-4">
                      Your free trial ends {formatDate(status.trial_ends_at)} — your card will be charged automatically unless you cancel first.
                    </p>
                  )}
                  {status.subscription_status === "active" && status.current_period_end && (
                    <p className="text-sm text-mute mb-4">Next charge {formatDate(status.current_period_end)}.</p>
                  )}
                  {status.subscription_status === "cancelled" && status.current_period_end && (
                    <p className="text-sm text-mute mb-4">
                      Your subscription is cancelled — the dashboard stays available until {formatDate(status.current_period_end)}.
                    </p>
                  )}
                  {status.subscription_status === "paused" && (
                    <p className="text-sm text-mute mb-4">Billing is paused on this subscription. Resume it below to restore access.</p>
                  )}
                  {(status.subscription_status === "past_due" || status.subscription_status === "unpaid") && (
                    <p className="text-sm mb-4" style={{ color: "#8A5A17" }}>
                      Your last payment didn't go through. Update your card below to keep the dashboard available.
                    </p>
                  )}

                  <button
                    onClick={openPortal}
                    disabled={openingPortal}
                    className="text-sm font-medium text-white px-4 py-2.5 rounded-lg flex items-center gap-2 disabled:opacity-60"
                    style={{ backgroundColor: "#0B0B0D" }}
                >
                    {openingPortal ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                    Manage billing
                  </button>
                </div>
              )}

              {needsPlanSelection(status) && (
                <>
                  {status.subscription_status === "expired" && (
                    <p className="text-sm text-mute mb-6">Your subscription has ended. Choose a plan to start a new one.</p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-5">
                    {PLANS.map((p) => (
                      <div key={p.id} className="bg-white rounded-2xl border border-line p-6 flex flex-col">
                        <div className="text-sm font-medium text-coral mb-1">{p.name}</div>
                        <div className="ev-display text-4xl mb-2">{p.price}</div>
                        <p className="text-sm text-mute mb-4 leading-relaxed">{p.desc}</p>
                        <ul className="flex flex-col gap-2 mb-6 flex-1">
                          {p.features.map((f) => (
                            <li key={f} className="flex items-start gap-2 text-sm">
                              <Check size={14} className="mt-0.5 shrink-0" color="#1E7B52" /> {f}
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => startCheckout(p.id)}
                          disabled={pendingPlan !== null}
                          className="text-sm font-medium text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
                          style={{ backgroundColor: "#0B0B0D" }}
                      >
                          {pendingPlan === p.id && <Loader2 size={14} className="animate-spin" />}
                          Start 7-day free trial
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-clay mt-4">
                    Your card is charged automatically after the trial unless you cancel first — no separate reminder, cancel any time from this page.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
