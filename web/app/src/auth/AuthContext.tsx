import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type StaffUser, type TwoFactorLoginChallenge } from "../api/client";

const TOKEN_STORAGE_KEY = "flywheel.session_token";
// Which of the account's (possibly several) businesses the dashboard is
// currently operating on -- purely a client-side choice (see
// resolveBusinessId), since every dashboard API call already takes
// business_id as a URL path parameter (src/api/dependencies.py's
// require_own_business), not something the backend needs to track.
const BUSINESS_STORAGE_KEY = "flywheel.selected_business_id";

interface AuthContextValue {
  user: StaffUser | null;
  token: string | null;
  loading: boolean;
  /** The business the dashboard is currently operating on. Null only when
   * the account has no businesses yet (RequireBusiness sends it to
   * /onboarding in that case). */
  businessId: string | null;
  /** Switch which of the account's businesses the dashboard operates on. */
  selectBusiness: (businessId: string) => void;
  signup: (email: string, password: string) => Promise<StaffUser>;
  login: (email: string, password: string) => Promise<StaffUser | TwoFactorLoginChallenge>;
  completeTwoFactorLogin: (challengeToken: string, code: string) => Promise<StaffUser>;
  logout: () => Promise<void>;
  setUser: (user: StaffUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Prefers whatever was last explicitly selected (if the account still has
 * access to it), then the account's server-side active business, then just
 * the first one on record. */
function resolveBusinessId(user: StaffUser | null): string | null {
  if (!user || user.business_ids.length === 0) return null;
  const stored = localStorage.getItem(BUSINESS_STORAGE_KEY);
  if (stored && user.business_ids.includes(stored)) return stored;
  return user.business_id && user.business_ids.includes(user.business_id)
    ? user.business_id
    : user.business_ids[0];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUserState] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [businessId, setBusinessIdState] = useState<string | null>(null);

  const setUser = useCallback((nextUser: StaffUser) => setUserState(nextUser), []);

  const selectBusiness = useCallback((nextBusinessId: string) => {
    localStorage.setItem(BUSINESS_STORAGE_KEY, nextBusinessId);
    setBusinessIdState(nextBusinessId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me(token);
        if (!cancelled) {
          setUserState(me);
          setBusinessIdState(resolveBusinessId(me));
        }
      } catch {
        if (!cancelled) {
          setToken(null);
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signup = useCallback(async (email: string, password: string) => {
    const session = await api.signup(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
    setToken(session.token);
    setUserState(session.user);
    setBusinessIdState(resolveBusinessId(session.user));
    return session.user;
  }, []);

  const storeSession = useCallback((session: { token: string; user: StaffUser }) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
    setToken(session.token);
    setUserState(session.user);
    setBusinessIdState(resolveBusinessId(session.user));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.login(email, password);
    if ("two_factor_required" in session) return session;
    storeSession(session);
    return session.user;
  }, [storeSession]);

  const completeTwoFactorLogin = useCallback(async (challengeToken: string, code: string) => {
    const session = await api.completeTwoFactorLogin(challengeToken, code);
    storeSession(session);
    return session.user;
  }, [storeSession]);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // Best effort — clear local state regardless of whether the server call succeeded.
      }
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(BUSINESS_STORAGE_KEY);
    setToken(null);
    setUserState(null);
    setBusinessIdState(null);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, businessId, selectBusiness, signup, login, completeTwoFactorLogin, logout, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Turns an ApiError's backend error code into copy a business owner can act on. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "email_already_registered":
        return "An account with this email already exists — try logging in instead.";
      case "invalid_credentials":
        return "That email or password isn't right.";
      case "business_id_taken":
        return "That business name is already taken — try a slightly different name.";
      case "validation_error":
        return "Use a password of at least 12 characters, or check the fields and try again.";
      case "conversation_not_linked":
        return "This conversation isn't linked to a case yet, so there's nothing to resolve.";
      case "conversation_closed":
        return "This conversation is already closed.";
      case "case_not_awaiting_approval":
        return "This case isn't waiting on your review anymore — someone may have already resolved it.";
      case "conversation_not_found":
        return "That conversation couldn't be found.";
      case "billing_not_configured":
        return "Billing isn't set up on this deployment yet.";
      case "invalid_plan":
        return "That plan isn't available right now.";
      case "billing_account_not_found":
        return "Start a subscription first — there's nothing to manage yet.";
      case "subscription_inactive":
        return "This business's subscription needs attention before the dashboard is available.";
      case "forbidden":
        return "You don't have access to this business.";
      case "sales_playbook_not_found":
        return "No published sales playbook was found.";
      case "sales_profile_not_found":
        return "No sales conversation profile yet for this case.";
      case "sales_knowledge_not_found":
        return "That knowledge card could not be found.";
      case "sales_knowledge_already_reviewed":
        return "This knowledge card has already been reviewed.";
      case "network_error":
        return err.message;
      default:
        return err.message || "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
