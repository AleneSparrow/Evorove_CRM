import { useEffect, useState, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";

function FullscreenLoader() {
  return (
    <div className="ev-page min-h-screen w-full flex items-center justify-center">
      <span className="text-sm text-mute">Loading…</span>
    </div>
  );
}

/** Sends anonymous visitors to log in before reaching an authenticated page. */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { user, token, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullscreenLoader />;
  if (!token || !user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

/** Sends authenticated owners with no business yet into the onboarding wizard. */
export function RequireBusiness({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (user && user.business_ids.length === 0) return <Navigate to="/onboarding" replace />;
  return children;
}

/** Gates the dashboard/conversations views (the actual delivered product) on
 * the business having billing access -- mirrors the backend's
 * `require_active_subscription` (src/api/dependencies.py) so a business
 * without dashboard access never even sees the API's 402, it's redirected
 * straight to /app/billing instead. Settings and Billing itself are
 * deliberately NOT wrapped in this guard -- see App.tsx. */
export function RequireActiveSubscription({ children }: { children: ReactElement }) {
  const { token, businessId, loading: authLoading } = useAuth();
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHasAccess(null);
    if (!token || !businessId) return;
    api
      .getBillingStatus(token, businessId)
      .then((status) => {
        if (!cancelled) setHasAccess(status.has_billing_access);
      })
      .catch(() => {
        // If the billing check itself fails, don't trap the owner behind a
        // loader forever -- let them through and rely on the backend's own
        // 402 gate as the actual enforcement.
        if (!cancelled) setHasAccess(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId]);

  if (authLoading || hasAccess === null) return <FullscreenLoader />;
  if (!hasAccess) return <Navigate to="/app/billing" replace />;
  return children;
}
