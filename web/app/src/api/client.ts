/**
 * Thin fetch wrapper around the real backend (see src/api in the repo root).
 * Endpoints wired here are the ones that actually exist and are tested:
 *   POST /api/v1/auth/signup
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 *   POST /api/v1/businesses                                    (self-serve onboarding)
 *   GET  /api/v1/businesses/{id}                                (safe public metadata)
 *   GET  /api/v1/businesses/{id}/cases                          (Milestone 8 slice 2)
 *   GET  /api/v1/businesses/{id}/cases/{case_id}                (Milestone 8 slice 2)
 *   GET  /api/v1/businesses/{id}/conversations                  (Milestone 8 slice 2)
 *   GET  /api/v1/businesses/{id}/conversations/{conversation_id} (Milestone 8 slice 2)
 *   POST /api/v1/businesses/{id}/conversations/{conversation_id}/reply   (staff reply)
 *   POST /api/v1/businesses/{id}/conversations/{conversation_id}/resolve (staff resolve)
 *   GET  /api/v1/businesses/{id}/dna                            (live Business DNA settings)
 *   PUT  /api/v1/businesses/{id}/dna                            (live Business DNA settings)
 *   GET  /api/v1/businesses/{id}/billing                        (subscription status)
 *   POST /api/v1/businesses/{id}/billing/checkout-session       (self-serve Stripe Checkout)
 *   POST /api/v1/businesses/{id}/billing/portal-session          (self-serve Stripe Billing Portal)
 *   GET  /api/v1/businesses/{id}/sales/playbook                 (active published playbook)
 *   GET  /api/v1/businesses/{id}/sales/playbooks                (playbook version list)
 *   GET  /api/v1/businesses/{id}/sales/knowledge-cards          (optional ?status=)
 *   POST /api/v1/businesses/{id}/sales/knowledge-cards/{id}/versions/{v}/approve
 *   POST /api/v1/businesses/{id}/sales/knowledge-cards/{id}/versions/{v}/reject
 *   GET  /api/v1/businesses/{id}/sales/cases/{case_id}          (sales conversation context)
 *   GET  /api/v1/businesses/{id}/sales/cases/{case_id}/turns    (provenance / sales turns)
 *
 * reply/resolve only work while the case is actually NEEDS_HUMAN with a pending
 * transition (see StaffActionService) — resolve approves that exact pending
 * transition, it doesn't invent a new one. The dna endpoints only touch what
 * Settings actually edits (name/industry/tone, services + their qualification
 * questions, service-area zip codes, urgency-based escalation) — see
 * BusinessDNASettingsService for what's carried over unchanged.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  request_id?: string;
  details?: unknown;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, { code: "network_error", message: "Couldn't reach the server. Check your connection and try again." });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload: ApiErrorPayload = body?.error ?? {
      code: "unknown_error",
      message: "Something went wrong. Please try again.",
    };
    throw new ApiError(response.status, errorPayload);
  }

  return body as T;
}

export interface StaffUser {
  user_id: string;
  name: string | null;
  email: string;
  business_id: string | null;
  // Every business this account is linked to -- business_id above is just
  // the active one (a member of this list, or null when it's empty). One
  // account may own more than one business.
  business_ids: string[];
}

export interface OwnedBusiness {
  business_id: string;
  name: string;
}

export interface SessionResponse {
  token: string;
  expires_in_hours: number;
  user: StaffUser;
}

export interface TwoFactorLoginChallenge {
  two_factor_required: true;
  challenge_token: string;
  expires_in_minutes: number;
}

export interface TwoFactorSetup {
  secret: string;
  provisioning_uri: string;
  expires_in_minutes: number;
}

export interface SecurityStatus {
  two_factor_enabled: boolean;
  recovery_codes_remaining: number;
}

export interface SecuritySession {
  session_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  current: boolean;
}

export interface SecurityAuditEvent {
  event_id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface BusinessCreatedResponse {
  business_id: string;
  name: string;
  widget_snippet: string;
}

export interface BusinessResponse {
  business_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface OnboardingServicePayload {
  name: string;
  questions: string[];
}

export interface OnboardingPayload {
  business_name: string;
  industry: string;
  /** Optional plain-language description of what the business does. With
   * `industry`, this is what lets the engine map a customer's own wording onto
   * the service catalog without configured keyword synonyms. */
  description?: string;
  tone: string;
  services: OnboardingServicePayload[];
  /** Empty means "no fixed service area" (a remote/nationwide business) --
   * see BusinessDNASettingsService / build_business_dna for how that maps to
   * a `remote` service area instead of `postal_codes`. */
  service_zip_codes: string[];
  enforce_service_area: boolean;
  escalate_on_high_urgency: boolean;
  escalate_on_emergency: boolean;
}

export type ProcessState =
  | "NEW_LEAD"
  | "CONTACTED"
  | "QUALIFYING"
  | "QUALIFIED"
  | "BOOKED"
  | "QUOTED"
  | "FOLLOW_UP"
  | "WON"
  | "PAID"
  | "COMPLETED"
  | "REVIEW_REQUESTED"
  | "REACTIVATION"
  | "NEEDS_HUMAN"
  | "LOST"
  | "CANCELLED";

export interface DashboardLead {
  lead_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface DashboardCaseSummary {
  case_id: string;
  lead: DashboardLead;
  current_state: ProcessState;
  created_at: string;
  updated_at: string;
  event_count: number;
  latest_event_type: string | null;
  category: string | null;
  escalation_reason: string | null;
  is_test: boolean;
}

export interface DashboardCaseListResponse {
  cases: DashboardCaseSummary[];
}

export interface DashboardAppointment {
  booking_id: string;
  case_id: string;
  lead: DashboardLead;
  service_id: string;
  service_name: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: string;
}

export interface DashboardWaiting {
  case_id: string;
  lead: DashboardLead;
  service_id: string | null;
  service_name: string | null;
  waiting_channel: string | null;
  updated_at: string;
}

export interface DashboardAppointmentListResponse {
  day: string;
  timezone: string;
  appointments: DashboardAppointment[];
  waiting: DashboardWaiting[];
}

export interface DashboardAnalytics {
  total_cases: number;
  booked_cases: number;
  escalated_cases: number;
  lost_cases: number;
  booking_conversion_rate: number;
  escalation_rate: number;
  lost_rate: number;
  median_first_response_seconds: number | null;
  response_samples: number;
  escalation_reasons: Record<string, number>;
  escalation_feedback: Record<
    "unnecessary" | "missed" | "wrong_service" | "identity_same_customer" | "identity_different_customer",
    number
  >;
  hidden_test_cases: number;
  hidden_test_conversations: number;
  includes_test_data: boolean;
  stats_since: string | null;
  period_start: string | null;
  period_end: string | null;
}

export interface ReportingSettings {
  test_mode_enabled: boolean;
  stats_since: string | null;
}

export interface ReportingSettingsUpdate {
  test_mode_enabled?: boolean;
  reset_statistics?: boolean;
  clear_statistics_baseline?: boolean;
}

export interface ReportingScope {
  startDate?: string;
  endDate?: string;
  includeTest?: boolean;
  ignoreBaseline?: boolean;
}

export interface DashboardEvent {
  event_id: string;
  event_type: string;
  source: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface DashboardCaseDetail {
  case_id: string;
  lead: DashboardLead;
  current_state: ProcessState;
  created_at: string;
  updated_at: string;
  events: DashboardEvent[];
  escalation_reason: string | null;
}

export interface DashboardConversationSummary {
  conversation_id: string;
  case_id: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  case_state: ProcessState | null;
  channel: string;
  status: "ai_active" | "human_takeover_requested" | "human_takeover_active" | "closed";
  created_at: string;
  last_activity_at: string;
  escalation_reason: string | null;
}

export interface DashboardConversationListResponse {
  conversations: DashboardConversationSummary[];
}

export interface DashboardMessage {
  message_id: string;
  direction: "inbound" | "outbound";
  role: "customer" | "assistant" | "human" | "system";
  text: string;
  created_at: string;
}

export interface DashboardConversationDetail {
  conversation: DashboardConversationSummary;
  messages: DashboardMessage[];
}

export interface StaffActionResponse {
  conversation: DashboardConversationSummary;
  case: DashboardCaseSummary | null;
}

/** Conversational sales progress. Distinct from ProcessState, which is the case commitment. */
export type SalesStage =
  | "GREETING"
  | "DISCOVERY"
  | "NEEDS_CONFIRMED"
  | "PRESENTATION"
  | "OBJECTION_HANDLING"
  | "COMMITMENT"
  | "BOOKING"
  | "NURTURE"
  | "FOLLOW_UP"
  | "WON"
  | "LOST"
  | "HUMAN_REVIEW";

export type SalesMove =
  | "GREET_AND_SET_CONTEXT"
  | "ASK_DISCOVERY_QUESTION"
  | "REFLECT_CUSTOMER_NEED"
  | "CONFIRM_CUSTOMER_NEED"
  | "PRESENT_RELEVANT_VALUE"
  | "PROVIDE_APPROVED_PROOF"
  | "DIAGNOSE_OBJECTION"
  | "ANSWER_OBJECTION"
  | "CHECK_OBJECTION_RESOLUTION"
  | "ASK_FOR_COMMITMENT"
  | "OFFER_BOOKING_SLOTS"
  | "SCHEDULE_CALLBACK"
  | "SEND_CONTEXTUAL_FOLLOW_UP"
  | "NURTURE_WITHOUT_PRESSURE"
  | "HANDOFF_TO_HUMAN"
  | "END_CONTACT";

export type SalesPlaybookStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type SalesKnowledgeStatus = "CANDIDATE" | "APPROVED" | "REJECTED";

export interface SalesPlaybook {
  business_id: string;
  version: number;
  status: SalesPlaybookStatus;
  configuration: Record<string, unknown>;
  created_at: string;
  published_at: string | null;
}

export interface SalesPlaybookListResponse {
  playbooks: SalesPlaybook[];
}

export interface SalesKnowledgeCard {
  knowledge_id: string;
  business_id: string;
  version: number;
  status: SalesKnowledgeStatus;
  source: Record<string, unknown>;
  principle: string;
  applicable_when: string[];
  prohibited_when: string[];
  required_sequence: string[];
  forbidden_actions: string[];
  approved_examples: string[];
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface SalesKnowledgeCardListResponse {
  cards: SalesKnowledgeCard[];
}

export interface SalesObjectionRecord {
  objection_id: string;
  objection_type: string;
  status: string;
  cause: string | null;
  source_message_id: string;
  evidence_excerpt: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface SalesCaseContext {
  case_id: string;
  stage: SalesStage;
  customer_goal: string | null;
  current_problem: string | null;
  desired_outcome: string | null;
  decision_criteria: string[];
  commitment_level: string;
  preferred_channel: string | null;
  preferred_contact_at: string | null;
  last_move: SalesMove | null;
  next_approved_action: SalesMove;
  next_action_reason: string;
  requires_human: boolean;
  human_review_reason: string | null;
  version: number;
  objections: SalesObjectionRecord[];
}

export interface SalesEvidence {
  source_message_id: string;
  excerpt: string;
}

export interface SalesTurn {
  turn_id: string;
  conversation_id: string | null;
  source_message_id: string;
  playbook_version: number | null;
  stage_before: SalesStage;
  stage_after: SalesStage;
  move: SalesMove;
  reason_code: string;
  knowledge_ids: string[];
  business_fact_ids: string[];
  customer_evidence: SalesEvidence[];
  analysis: Record<string, unknown>;
  validation: Record<string, unknown>;
  created_at: string;
}

export interface SalesTurnListResponse {
  turns: SalesTurn[];
}

// What a service does once a lead qualifies for it -- see
// CommercialPathSelector (src/engine/commercial.py) and
// BusinessDNASettingsService._COMMERCIAL_PATHS on the backend.
export type CommercialPath = "booking" | "quote" | "direct_step" | "human_review";

export interface BusinessDNAService {
  id: string;
  name: string;
  description: string;
  questions: string[];
  commercial_path: CommercialPath;
  quote_price: string | null;
  next_step_message: string | null;
  intake_keywords: string[];
}

export interface BusinessHoursWindow {
  opens: string;
  closes: string;
}

// One owner-authored {objection, pre-approved response} pair -- see
// qualification.objection_responses in the Business DNA schema. The AI only
// ever selects and rephrases one of these entries, never invents its own.
export interface ObjectionResponse {
  trigger_description: string;
  approved_response: string;
}

export interface BusinessDNASettings {
  version: number;
  updated_at: string;
  name: string;
  industry: string;
  tone: string;
  services: BusinessDNAService[];
  service_zip_codes: string[];
  escalate_on_high_urgency: boolean;
  escalate_on_emergency: boolean;
  booking_enabled: boolean;
  booking_timezone: string;
  business_hours: Record<string, BusinessHoursWindow[]>;
  objection_responses: ObjectionResponse[];
  /** Ready-to-paste <script> tag that mounts the customer-facing chat widget
   * on the business's own website -- see _widget_embed_snippet in
   * src/api/schemas.py. Absolute URL to this deployment, safe to copy as-is. */
  widget_snippet: string;
  compliance_disclaimer: string;
  ai_disclosure_text: string;
}

export interface BusinessDNAServiceUpdate {
  id?: string;
  name: string;
  description?: string;
  questions: string[];
  commercial_path: CommercialPath;
  quote_price: string | null;
  next_step_message: string | null;
  intake_keywords?: string[];
}

export interface BusinessDNASettingsUpdate {
  name: string;
  industry: string;
  tone: string;
  services: BusinessDNAServiceUpdate[];
  service_zip_codes: string[];
  escalate_on_high_urgency: boolean;
  escalate_on_emergency: boolean;
  booking_enabled: boolean;
  booking_timezone: string;
  business_hours: Record<string, BusinessHoursWindow[]>;
  objection_responses: ObjectionResponse[];
  compliance_disclaimer?: string;
  ai_disclosure_text?: string;
}

export type BillingPlan = "starter" | "pro";

/** subscription_status mirrors the Lemon Squeezy Subscription `status` values
 * this app branches on (see BillingService), plus "incomplete" for a business
 * that has never started checkout. Note "cancelled" still means the business
 * has billing access -- Lemon Squeezy's own semantics are "the customer
 * cancelled, but access is paid through current_period_end" (see
 * ACTIVE_SUBSCRIPTION_STATUSES in src/domain/tenancy.py); "expired" is the
 * actual terminal state. has_billing_access is the same check the backend
 * uses to gate the dashboard (Business.has_billing_access) -- trusting it
 * here keeps the frontend and backend gates from ever disagreeing. */
export interface BillingStatus {
  plan: BillingPlan | null;
  subscription_status: "incomplete" | "on_trial" | "active" | "paused" | "past_due" | "unpaid" | "cancelled" | "expired";
  trial_ends_at: string | null;
  current_period_end: string | null;
  has_billing_access: boolean;
}

export interface SmsStatus {
  configured: boolean;
  phone_number: string | null;
}

export interface CrmWebhookStatus {
  configured: boolean;
}

export interface CheckoutSessionResponse {
  checkout_url: string;
}

export interface PortalSessionResponse {
  portal_url: string;
}

export const api = {
  signup: (email: string, password: string) =>
    request<SessionResponse>("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<SessionResponse | TwoFactorLoginChallenge>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  completeTwoFactorLogin: (challengeToken: string, code: string) =>
    request<SessionResponse>("/api/v1/auth/login/two-factor", {
      method: "POST",
      headers: { "X-Two-Factor-Challenge": challengeToken },
      body: JSON.stringify({ code }),
    }),

  forgotPassword: (email: string) => request<{ message: string }>("/api/v1/auth/forgot-password", {
    method: "POST", body: JSON.stringify({ email }),
  }),

  resetPassword: (token: string, password: string) => request<void>("/api/v1/auth/reset-password", {
    method: "POST", body: JSON.stringify({ token, password }),
  }),

  logout: (token: string) => request<void>("/api/v1/auth/logout", { method: "POST" }, token),

  me: (token: string) => request<StaffUser>("/api/v1/auth/me", { method: "GET" }, token),

  updateProfile: (token: string, name: string) => request<StaffUser>("/api/v1/auth/me", {
    method: "PATCH", body: JSON.stringify({ name }),
  }, token),

  getSecurityStatus: (token: string) => request<SecurityStatus>("/api/v1/auth/security", { method: "GET" }, token),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/auth/security/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }, token),
  beginTwoFactorSetup: (token: string, currentPassword: string) => request<TwoFactorSetup>("/api/v1/auth/security/two-factor/setup", { method: "POST", body: JSON.stringify({ current_password: currentPassword }) }, token),
  confirmTwoFactorSetup: (token: string, code: string) => request<{ codes: string[] }>("/api/v1/auth/security/two-factor/confirm", { method: "POST", body: JSON.stringify({ code }) }, token),
  disableTwoFactor: (token: string, currentPassword: string, code: string) =>
    request<void>("/api/v1/auth/security/two-factor/disable", { method: "POST", body: JSON.stringify({ current_password: currentPassword, code }) }, token),
  regenerateRecoveryCodes: (token: string, currentPassword: string, code: string) =>
    request<{ codes: string[] }>("/api/v1/auth/security/recovery-codes", { method: "POST", body: JSON.stringify({ current_password: currentPassword, code }) }, token),
  listSecuritySessions: (token: string) => request<SecuritySession[]>("/api/v1/auth/security/sessions", { method: "GET" }, token),
  revokeSecuritySession: (token: string, sessionId: string) => request<void>(`/api/v1/auth/security/sessions/${sessionId}`, { method: "DELETE" }, token),
  revokeOtherSecuritySessions: (token: string) => request<{ revoked: number }>("/api/v1/auth/security/sessions/revoke-others", { method: "POST" }, token),
  listSecurityAudit: (token: string) => request<SecurityAuditEvent[]>("/api/v1/auth/security/audit", { method: "GET" }, token),

  createBusiness: (token: string, payload: OnboardingPayload) =>
    request<BusinessCreatedResponse>(
      "/api/v1/businesses",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),

  getBusiness: (businessId: string) => request<BusinessResponse>(`/api/v1/businesses/${businessId}`),

  listMyBusinesses: (token: string) =>
    request<OwnedBusiness[]>("/api/v1/businesses", { method: "GET" }, token),

  listCases: (token: string, businessId: string, options?: ReportingScope) => {
    const params = new URLSearchParams();
    if (options?.startDate && options.endDate) {
      params.set("start_date", options.startDate);
      params.set("end_date", options.endDate);
    }
    if (options?.includeTest) params.set("include_test", "true");
    if (options?.ignoreBaseline) params.set("ignore_baseline", "true");
    const query = params.size ? `?${params}` : "";
    return request<DashboardCaseListResponse>(`/api/v1/businesses/${businessId}/cases${query}`, { method: "GET" }, token);
  },

  listAppointments: (token: string, businessId: string, on?: string) => {
    const params = new URLSearchParams();
    if (on) params.set("on", on);
    const query = params.size ? `?${params}` : "";
    return request<DashboardAppointmentListResponse>(
      `/api/v1/businesses/${businessId}/appointments${query}`,
      { method: "GET" },
      token,
    );
  },

  getDashboardAnalytics: (
    token: string,
    businessId: string,
    options?: ReportingScope,
  ) => {
    const params = new URLSearchParams();
    if (options?.startDate && options.endDate) {
      params.set("start_date", options.startDate);
      params.set("end_date", options.endDate);
    }
    if (options?.includeTest) params.set("include_test", "true");
    const query = params.size ? `?${params}` : "";
    return request<DashboardAnalytics>(`/api/v1/businesses/${businessId}/analytics${query}`, { method: "GET" }, token);
  },

  getReportingSettings: (token: string, businessId: string) =>
    request<ReportingSettings>(`/api/v1/businesses/${businessId}/analytics/settings`, { method: "GET" }, token),

  updateReportingSettings: (token: string, businessId: string, update: ReportingSettingsUpdate) =>
    request<ReportingSettings>(`/api/v1/businesses/${businessId}/analytics/settings`, {
      method: "PATCH",
      body: JSON.stringify(update),
    }, token),

  getCase: (token: string, businessId: string, caseId: string) =>
    request<DashboardCaseDetail>(`/api/v1/businesses/${businessId}/cases/${caseId}`, { method: "GET" }, token),

  listConversations: (token: string, businessId: string) =>
    request<DashboardConversationListResponse>(
      `/api/v1/businesses/${businessId}/conversations`,
      { method: "GET" },
      token,
    ),

  getConversation: (token: string, businessId: string, conversationId: string) =>
    request<DashboardConversationDetail>(
      `/api/v1/businesses/${businessId}/conversations/${conversationId}`,
      { method: "GET" },
      token,
    ),

  replyToConversation: (token: string, businessId: string, conversationId: string, message: string) =>
    request<StaffActionResponse>(
      `/api/v1/businesses/${businessId}/conversations/${conversationId}/reply`,
      { method: "POST", body: JSON.stringify({ message }) },
      token,
    ),

  resolveConversation: (token: string, businessId: string, conversationId: string) =>
    request<StaffActionResponse>(
      `/api/v1/businesses/${businessId}/conversations/${conversationId}/resolve`,
      { method: "POST", body: JSON.stringify({}) },
      token,
    ),

  recordEscalationFeedback: (
    token: string,
    businessId: string,
    conversationId: string,
    outcome: "unnecessary" | "missed" | "wrong_service" | "identity_same_customer" | "identity_different_customer",
  ) =>
    request<StaffActionResponse>(
      `/api/v1/businesses/${businessId}/conversations/${conversationId}/escalation-feedback`,
      { method: "POST", body: JSON.stringify({ outcome }) },
      token,
    ),

  getBusinessDNASettings: (token: string, businessId: string) =>
    request<BusinessDNASettings>(`/api/v1/businesses/${businessId}/dna`, { method: "GET" }, token),

  updateBusinessDNASettings: (token: string, businessId: string, payload: BusinessDNASettingsUpdate) =>
    request<BusinessDNASettings>(
      `/api/v1/businesses/${businessId}/dna`,
      { method: "PUT", body: JSON.stringify(payload) },
      token,
    ),

  getBillingStatus: (token: string, businessId: string) =>
    request<BillingStatus>(`/api/v1/businesses/${businessId}/billing`, { method: "GET" }, token),

  createCheckoutSession: (token: string, businessId: string, plan: BillingPlan) =>
    request<CheckoutSessionResponse>(
      `/api/v1/businesses/${businessId}/billing/checkout-session`,
      { method: "POST", body: JSON.stringify({ plan }) },
      token,
    ),

  createPortalSession: (token: string, businessId: string) =>
    request<PortalSessionResponse>(
      `/api/v1/businesses/${businessId}/billing/portal-session`,
      { method: "POST", body: JSON.stringify({}) },
      token,
    ),

  getSmsStatus: (token: string, businessId: string) =>
    request<SmsStatus>(`/api/v1/businesses/${businessId}/integrations/sms`, { method: "GET" }, token),

  provisionSms: (token: string, businessId: string) =>
    request<SmsStatus>(
      `/api/v1/businesses/${businessId}/integrations/sms/provision`,
      { method: "POST", body: JSON.stringify({}) },
      token,
    ),

  getCrmWebhookStatus: (token: string, businessId: string) =>
    request<CrmWebhookStatus>(
      `/api/v1/businesses/${businessId}/integrations/crm-webhook`,
      { method: "GET" },
      token,
    ),

  configureCrmWebhook: (token: string, businessId: string, webhookUrl: string) =>
    request<CrmWebhookStatus>(
      `/api/v1/businesses/${businessId}/integrations/crm-webhook`,
      { method: "PUT", body: JSON.stringify({ webhook_url: webhookUrl }) },
      token,
    ),

  removeCrmWebhook: (token: string, businessId: string) =>
    request<CrmWebhookStatus>(
      `/api/v1/businesses/${businessId}/integrations/crm-webhook`,
      { method: "DELETE" },
      token,
    ),

  getActiveSalesPlaybook: (token: string, businessId: string) =>
    request<SalesPlaybook>(`/api/v1/businesses/${businessId}/sales/playbook`, { method: "GET" }, token),

  listSalesPlaybooks: (token: string, businessId: string) =>
    request<SalesPlaybookListResponse>(
      `/api/v1/businesses/${businessId}/sales/playbooks`,
      { method: "GET" },
      token,
    ),

  listSalesKnowledgeCards: (token: string, businessId: string, status?: SalesKnowledgeStatus) => {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<SalesKnowledgeCardListResponse>(
      `/api/v1/businesses/${businessId}/sales/knowledge-cards${query}`,
      { method: "GET" },
      token,
    );
  },

  approveSalesKnowledgeCard: (token: string, businessId: string, knowledgeId: string, version: number) =>
    request<SalesKnowledgeCard>(
      `/api/v1/businesses/${businessId}/sales/knowledge-cards/${encodeURIComponent(knowledgeId)}/versions/${version}/approve`,
      { method: "POST", body: JSON.stringify({}) },
      token,
    ),

  rejectSalesKnowledgeCard: (token: string, businessId: string, knowledgeId: string, version: number) =>
    request<SalesKnowledgeCard>(
      `/api/v1/businesses/${businessId}/sales/knowledge-cards/${encodeURIComponent(knowledgeId)}/versions/${version}/reject`,
      { method: "POST", body: JSON.stringify({}) },
      token,
    ),

  getCaseSalesContext: (token: string, businessId: string, caseId: string) =>
    request<SalesCaseContext>(
      `/api/v1/businesses/${businessId}/sales/cases/${encodeURIComponent(caseId)}`,
      { method: "GET" },
      token,
    ),

  listCaseSalesTurns: (token: string, businessId: string, caseId: string) =>
    request<SalesTurnListResponse>(
      `/api/v1/businesses/${businessId}/sales/cases/${encodeURIComponent(caseId)}/turns`,
      { method: "GET" },
      token,
    ),

  getLeadSearch: (token: string, businessId: string) =>
    request<LeadSearchStatus>(`/api/v1/businesses/${businessId}/board/search`, { method: "GET" }, token),

  startLeadSearch: (token: string, businessId: string, siteUrl: string) =>
    request<LeadSearchStatus>(
      `/api/v1/businesses/${businessId}/board/search`,
      { method: "POST", body: JSON.stringify({ site_url: siteUrl }) },
      token,
    ),

  listBoard: (token: string, businessId: string, tab: BoardTab) =>
    request<BoardListResponse>(
      `/api/v1/businesses/${businessId}/board?tab=${encodeURIComponent(tab)}`,
      { method: "GET" },
      token,
    ),

  getBoardPerson: (token: string, businessId: string, personId: string) =>
    request<BoardPersonDetail>(
      `/api/v1/businesses/${businessId}/board/people/${encodeURIComponent(personId)}`,
      { method: "GET" },
      token,
    ),

  issueBoardCommand: (
    token: string,
    businessId: string,
    personId: string,
    action: "discard" | "correct_identity" | "pause_outreach" | "takeover",
    fields?: { name?: string; phone?: string; email?: string },
  ) =>
    request<BoardCommand>(
      `/api/v1/businesses/${businessId}/board/people/${encodeURIComponent(personId)}/commands`,
      { method: "POST", body: JSON.stringify({ action, ...fields }) },
      token,
    ),
};

export { API_BASE };

export type BoardTab = "cold" | "in_work" | "offer_sent" | "done";

export interface LeadSearchStatus {
  business_id: string;
  status: string; // never_run | not_set_up | queued | running | people_found | no_fit | failed | ...
  site_url: string | null;
  cold: number;
  last_run_at: string | null;
}

export interface BoardPerson {
  person_id: string;
  tab: BoardTab | "discarded";
  name: string | null;
  phone: string | null;
  email: string | null;
  summary: string;
  last_kind: string;
  last_cycle: number;
  last_touch_at: string;
  paused: boolean;
}

export interface BoardTouch {
  touch_id: string;
  cycle: number;
  kind: string;
  source: string;
  summary: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface BoardCommand {
  command_id: string;
  action: string;
  status: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface BoardListResponse {
  tab: BoardTab;
  people: BoardPerson[];
}

export interface BoardPersonDetail {
  person: BoardPerson;
  touches: BoardTouch[];
  commands: BoardCommand[];
}
