import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireActiveSubscription, RequireAuth, RequireBusiness } from "./components/RouteGuards";
import Landing from "./pages/Landing";
import Faq from "./pages/Faq";
import LegalDocument from "./pages/LegalDocument";
import LawyersLanding from "./pages/LawyersLanding";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Conversation from "./pages/Conversation";
import Settings from "./pages/Settings";
import Billing from "./pages/Billing";
import Account from "./pages/Account";
import AppFaq from "./pages/AppFaq";

/** Shared layout element for every subscription-gated route (Overview,
 * Conversations). Previously /app and /app/conversations each had their
 * own <RequireActiveSubscription>, so switching between those two tabs
 * unmounted and remounted the guard on every click -- flashing a
 * full-screen loader and re-checking billing status each time, which is
 * what read as the tabs "jumping" (occasionally landing on /app/billing
 * while a fresh check was still in flight). Nesting both routes under one
 * instance + <Outlet/> means the guard mounts once per session instead of
 * once per navigation. */
function RequireSubscribedApp() {
  return (
    <RequireAuth>
      <RequireBusiness>
        <RequireActiveSubscription>
          <Outlet />
        </RequireActiveSubscription>
      </RequireBusiness>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/privacy" element={<LegalDocument key="privacy" docId="privacy" />} />
          <Route path="/terms" element={<LegalDocument key="terms" docId="terms" />} />
          <Route path="/dpa" element={<LegalDocument key="dpa" docId="dpa" />} />
          <Route path="/subprocessors" element={<LegalDocument key="subprocessors" docId="subprocessors" />} />
          <Route path="/lawyers" element={<LawyersLanding />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/onboarding"
            element={
              // Reachable at any time, not just before an account's first
              // business -- it's also how an owner adds another business
              // (see Sidebar's "Add another business" link).
              <RequireAuth>
                <Onboarding />
              </RequireAuth>
            }
          />
          <Route element={<RequireSubscribedApp />}>
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/conversations" element={<Conversation />} />
          </Route>
          <Route
            path="/app/account"
            element={
              <RequireAuth>
                <Account />
              </RequireAuth>
            }
          />
          <Route
            path="/app/faq"
            element={
              <RequireAuth>
                <AppFaq />
              </RequireAuth>
            }
          />
          <Route
            path="/app/settings"
            element={
              <RequireAuth>
                <RequireBusiness>
                  <Settings />
                </RequireBusiness>
              </RequireAuth>
            }
          />
          <Route
            path="/app/billing"
            element={
              <RequireAuth>
                <RequireBusiness>
                  <Billing />
                </RequireBusiness>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
