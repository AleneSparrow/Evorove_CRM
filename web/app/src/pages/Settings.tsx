import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Globe, Loader2, MapPin, MessageSquare, Plus, RotateCcw, X } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { AreaOption, Field, formatRelativeTime, inputCls, ToneOption } from "../components/Shared";
import { useAuth, describeError } from "../auth/AuthContext";
import { API_BASE, api, type BusinessDNASettings, type CommercialPath, type CrmWebhookStatus, type ReportingSettings, type SmsStatus } from "../api/client";
import { StatisticsPanel } from "../components/StatisticsPanel";
import { SalesPlaybookSettings } from "../components/SalesPlaybookSettings";

// Grouped by the task a business owner actually has, not by which Business
// DNA schema section a field happens to live in -- "Services" and "Booking"
// used to be separate tabs even though a service only takes bookings once
// both its own "Book online" commercial path AND this section's timezone/hours
// are set; "Questions" and "Escalation" were split even though both are really
// "how the engine should handle the conversation." Four stops instead of
// seven the owner has to click through to find anything.
const SETTINGS_TABS = [
  { key: "widget", label: "Install widget" },
  { key: "basics", label: "Basics" },
  { key: "services", label: "Services & booking" },
  { key: "conversation", label: "Conversation" },
  { key: "playbook", label: "Sales Playbook" },
  // The key stays "reporting" so existing ?tab=reporting links keep working;
  // only what the owner reads changes. The tab holds actions on the numbers,
  // and "Statistics" says that where "Reporting" did not.
  { key: "reporting", label: "Statistics" },
  { key: "sms", label: "SMS" },
  { key: "crm", label: "CRM" },
] as const;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Weekday = (typeof WEEKDAYS)[number];
const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};
// Every value here is a real IANA zone the deterministic availability engine
// (src/engine/commercial.py) resolves via zoneinfo.
//
// The US zones stay pinned at the top because they are what almost every
// business picks today, but the list is NO LONGER US-only (2026-08-25): a
// US-registered business can operate from anywhere, and the roadmap opens
// other markets one at a time. Restricting the <select> to seven US zones
// meant anyone outside them simply could not state their real zone, and
// every appointment time they quoted was wrong.
const US_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

/** Every IANA zone the browser knows, minus the pinned US ones.
 *
 * Intl.supportedValuesOf is available in every browser this app targets; the
 * empty fallback keeps the pinned list working rather than throwing if it is
 * ever missing, which is the same failure mode as before this change.
 */
const WORLD_TIMEZONES: { value: string; label: string }[] = (() => {
  const pinned = new Set(US_TIMEZONES.map((tz) => tz.value));
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return all
    .filter((zone) => !pinned.has(zone))
    .map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));
})();

interface DayHoursState {
  open: boolean;
  opens: string;
  closes: string;
}
type WeekHoursState = Record<Weekday, DayHoursState>;

const DEFAULT_DAY_CLOSED: DayHoursState = { open: false, opens: "09:00", closes: "17:00" };

type TabKey = (typeof SETTINGS_TABS)[number]["key"];
const TAB_KEYS = new Set<string>(SETTINGS_TABS.map((t) => t.key));
function isTabKey(value: string | null): value is TabKey {
  return !!value && TAB_KEYS.has(value);
}

interface DNAServiceState {
  /** Client-only identity so React keys and cross-tab references (Services <-> Questions)
   * stay stable for a brand-new service that has no real `id` yet (assigned on first save). */
  key: string;
  id: string | null;
  name: string;
  description: string;
  questions: string[];
  /** What happens once a lead qualifies for this service — see
   * BusinessDNASettingsService._apply. "booking" only actually offers a slot
   * once the Booking tab's bookingEnabled is also on. */
  commercialPath: CommercialPath;
  /** Only used (and required) when commercialPath === "quote". Plain decimal
   * string, e.g. "150" or "89.50" — validated against the same pattern the
   * backend enforces (see _MONEY_PATTERN in business_dna_settings_service.py). */
  quotePrice: string;
  /** Only used (and required) when commercialPath === "direct_step". */
  nextStepMessage: string;
  intakeKeywords: string;
}

const QUOTE_PRICE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

const COMMERCIAL_PATH_OPTIONS: { value: CommercialPath; label: string }[] = [
  { value: "booking", label: "Book online" },
  { value: "quote", label: "Send a price quote" },
  { value: "direct_step", label: "Send next steps" },
  { value: "human_review", label: "Always hand off to you" },
];

interface ObjectionResponseState {
  /** Client-only identity, same purpose as DNAServiceState.key. */
  key: string;
  trigger: string;
  response: string;
}

interface SettingsState {
  name: string;
  industry: string;
  tone: string;
  services: DNAServiceState[];
  /** "remote" = no fixed service area (business.service_zip_codes comes back
   * empty from the server whenever the active area is `remote` rather than
   * `postal_codes` — see BusinessDNASettingsResponse.from_domain). */
  areaMode: "remote" | "local";
  zips: string;
  escalation: { highUrgency: boolean; emergency: boolean };
  bookingEnabled: boolean;
  bookingTimezone: string;
  hours: WeekHoursState;
  /** Owner-authored objection/pre-approved-response pairs -- see
   * qualification.objection_responses in the Business DNA schema. Empty
   * means the reassurance-response feature is off for this business. */
  objectionResponses: ObjectionResponseState[];
  complianceDisclaimer: string;
  aiDisclosureText: string;
}

/** Preset labels map to the exact copy `src/domain/business_dna_builder.py::_TONE_COPY`
 * stores in `communication.tone` — matching text is how the picker knows which preset
 * (if any) is currently active, since the field itself is just free text server-side. */
const TONE_PRESETS: { label: string; desc: string; copy: string }[] = [
  { label: "Friendly & direct", desc: "Warm, no filler", copy: "friendly, direct, and concise" },
  { label: "Formal & precise", desc: "Professional tone", copy: "formal, precise, and professional" },
  { label: "Casual & brief", desc: "Short, plain texts", copy: "casual, brief, and plainspoken" },
];

/** Both map to real `intent.urgency` values the engine extracts per message (see
 * `Urgency` in src/domain/qualification.py) — `QualificationService.evaluate()` checks
 * `intent.urgency.value in business_dna["human_escalation"]["triggers"]` directly, so
 * these two checkboxes are the actual, live escalation switches, not illustrative ones. */
const ESCALATION_OPTIONS: [keyof SettingsState["escalation"], string, string][] = [
  ["highUrgency", "Customer describes it as high urgency", "Hands off to you instead of letting the engine keep qualifying on its own."],
  ["emergency", "Customer describes it as an emergency", "Always hands off immediately — no automated next step at all."],
];

let clientKeySeq = 0;
function nextClientKey(): string {
  clientKeySeq += 1;
  return `svc-${clientKeySeq}-${Date.now()}`;
}

function fromServer(dna: BusinessDNASettings): SettingsState {
  const hours = WEEKDAYS.reduce((acc, day) => {
    const windows = dna.business_hours[day];
    acc[day] = windows && windows.length > 0
      ? { open: true, opens: windows[0].opens, closes: windows[0].closes }
      : { ...DEFAULT_DAY_CLOSED };
    return acc;
  }, {} as WeekHoursState);
  return {
    name: dna.name,
    industry: dna.industry,
    tone: dna.tone,
    services: dna.services.map((s) => ({
      key: nextClientKey(),
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      questions: [...s.questions],
      commercialPath: s.commercial_path,
      quotePrice: s.quote_price ?? "",
      nextStepMessage: s.next_step_message ?? "",
      intakeKeywords: (s.intake_keywords ?? []).join(", "),
    })),
    areaMode: dna.service_zip_codes.length === 0 ? "remote" : "local",
    zips: dna.service_zip_codes.join(", "),
    escalation: { highUrgency: dna.escalate_on_high_urgency, emergency: dna.escalate_on_emergency },
    bookingEnabled: dna.booking_enabled,
    // Live finding (2026-08-19): a business whose stored booking_timezone
    // isn't one of the real US zones below (e.g. a fresh business still on
    // the "UTC" onboarding default) fell into a React <select> footgun --
    // value={dna.booking_timezone} matches no <option>, so the browser just
    // displays the FIRST option ("Eastern") while the real bound value stays
    // "UTC". The owner sees "Eastern" selected, saves without touching it,
    // and Settings silently re-persists "UTC" -- which is exactly why
    // customers were seeing appointment times in UTC on a business whose
    // Settings page appeared to already say Eastern. Falling back to a real
    // zone here means the dropdown never again lies about what it's about
    // to save.
    // Checked against BOTH lists now -- a stored non-US zone used to fail this
    // test and get silently rewritten to Eastern on the next Settings save.
    bookingTimezone:
      US_TIMEZONES.some((tz) => tz.value === dna.booking_timezone) ||
      WORLD_TIMEZONES.some((tz) => tz.value === dna.booking_timezone)
        ? dna.booking_timezone
        : US_TIMEZONES[0].value,
    hours,
    objectionResponses: dna.objection_responses.map((o) => ({
      key: nextClientKey(),
      trigger: o.trigger_description,
      response: o.approved_response,
    })),
    complianceDisclaimer: dna.compliance_disclaimer ?? "",
    aiDisclosureText: dna.ai_disclosure_text ?? "",
  };
}

export default function Settings() {
  const navigate = useNavigate();
  const { token, businessId } = useAuth();
  // Kept in the URL (?tab=) rather than plain component state so a reload
  // -- or sharing/bookmarking the link -- lands back on the same tab
  // instead of always resetting to "business".
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = isTabKey(tabParam) ? tabParam : "widget";
  const setTab = (next: TabKey) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("tab", next);
      return params;
    }, { replace: true });
  };
  const tabRailRef = useRef<HTMLDivElement>(null);
  const scrollTabRail = (direction: -1 | 1) => {
    tabRailRef.current?.scrollBy({ left: direction * 160, behavior: "smooth" });
  };
  const [state, setState] = useState<SettingsState | null>(null);
  const [baseline, setBaseline] = useState<SettingsState | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newService, setNewService] = useState("");
  // Read-only, server-generated -- not part of SettingsState/fromServer since
  // it's never edited or compared for the dirty check, just displayed and
  // refreshed on the same schedule as everything else on the page.
  const [widgetSnippet, setWidgetSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);

  const [smsStatus, setSmsStatus] = useState<SmsStatus | null>(null);
  const [smsLoading, setSmsLoading] = useState(true);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsProvisioning, setSmsProvisioning] = useState(false);
  const [crmStatus, setCrmStatus] = useState<CrmWebhookStatus | null>(null);
  const [crmLoading, setCrmLoading] = useState(true);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [crmUrl, setCrmUrl] = useState("");
  const [crmSaving, setCrmSaving] = useState(false);
  const [reporting, setReporting] = useState<ReportingSettings | null>(null);
  const [reportingSaving, setReportingSaving] = useState(false);
  const [reportingError, setReportingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    setLoading(true);
    setLoadError(null);
    api
      .getBusinessDNASettings(token, businessId)
      .then((dna) => {
        if (cancelled) return;
        const mapped = fromServer(dna);
        setState(mapped);
        setBaseline(mapped);
        setVersion(dna.version);
        setUpdatedAt(dna.updated_at);
        setWidgetSnippet(dna.widget_snippet);
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
  }, [token, businessId]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    api.getReportingSettings(token, businessId)
      .then((value) => { if (!cancelled) setReporting(value); })
      .catch((err) => { if (!cancelled) setReportingError(describeError(err)); });
    return () => { cancelled = true; };
  }, [token, businessId]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    setSmsLoading(true);
    setSmsError(null);
    api
      .getSmsStatus(token, businessId)
      .then((status) => {
        if (!cancelled) setSmsStatus(status);
      })
      .catch((err) => {
        if (!cancelled) setSmsError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setSmsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    setCrmLoading(true);
    setCrmError(null);
    api
      .getCrmWebhookStatus(token, businessId)
      .then((status) => {
        if (!cancelled) setCrmStatus(status);
      })
      .catch((err) => {
        if (!cancelled) setCrmError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setCrmLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId]);

  const provisionSms = async () => {
    if (!token || !businessId) return;
    setSmsProvisioning(true);
    setSmsError(null);
    try {
      const status = await api.provisionSms(token, businessId);
      setSmsStatus(status);
    } catch (err) {
      setSmsError(describeError(err));
    } finally {
      setSmsProvisioning(false);
    }
  };

  const updateReporting = async (update: Parameters<typeof api.updateReportingSettings>[2]) => {
    if (!token || !businessId) return false;
    setReportingSaving(true);
    setReportingError(null);
    try {
      setReporting(await api.updateReportingSettings(token, businessId, update));
      return true;
    } catch (err) {
      setReportingError(describeError(err));
      return false;
    } finally {
      setReportingSaving(false);
    }
  };

  const dirty = useMemo(
    () => !!state && !!baseline && JSON.stringify(state) !== JSON.stringify(baseline),
    [state, baseline],
  );

  const zipList = useMemo(
    () => (state ? state.zips.split(",").map((z) => z.trim()).filter(Boolean) : []),
    [state],
  );
  const canSave =
    !!state &&
    state.name.trim().length > 0 &&
    state.industry.trim().length > 0 &&
    state.services.length > 0 &&
    state.services.every((s) => s.name.trim().length > 0) &&
    state.services.every((s) => {
      if (s.commercialPath === "quote") return QUOTE_PRICE_PATTERN.test(s.quotePrice.trim());
      if (s.commercialPath === "direct_step") {
        const msg = s.nextStepMessage.trim();
        return msg.length > 0 && msg.length <= 1000;
      }
      return true;
    }) &&
    (state.areaMode === "remote" || zipList.length > 0) &&
    // A fully blank row is fine (silently dropped on save, same as a blank
    // qualification question) -- only a HALF-filled row blocks save, so a
    // partly-typed objection never silently vanishes without feedback.
    state.objectionResponses.every((o) => (o.trigger.trim().length > 0) === (o.response.trim().length > 0));

  const addService = () => {
    const v = newService.trim();
    if (!state || !v) return;
    if (state.services.some((s) => s.name.toLowerCase() === v.toLowerCase())) return;
    setState({
      ...state,
      services: [
        ...state.services,
        { key: nextClientKey(), id: null, name: v, description: "", questions: [], commercialPath: "human_review", quotePrice: "", nextStepMessage: "", intakeKeywords: "" },
      ],
    });
    setNewService("");
  };
  const removeService = (key: string) => {
    if (!state) return;
    setState({ ...state, services: state.services.filter((s) => s.key !== key) });
  };

  const addObjection = () => {
    if (!state) return;
    setState({
      ...state,
      objectionResponses: [...state.objectionResponses, { key: nextClientKey(), trigger: "", response: "" }],
    });
  };
  const removeObjection = (key: string) => {
    if (!state) return;
    setState({ ...state, objectionResponses: state.objectionResponses.filter((o) => o.key !== key) });
  };
  const updateObjection = (key: string, field: "trigger" | "response", value: string) => {
    if (!state) return;
    setState({
      ...state,
      objectionResponses: state.objectionResponses.map((o) => (o.key === key ? { ...o, [field]: value } : o)),
    });
  };

  const save = async () => {
    if (!token || !businessId || !state || !canSave) return;
    setSaving(true);
    setSaveError(null);
    // canSave already guarantees no half-filled row -- only fully blank rows
    // get dropped here, same as a blank qualification question.
    const submittedObjections = state.objectionResponses.filter(
      (o) => o.trigger.trim().length > 0 && o.response.trim().length > 0,
    );
    try {
      const dna = await api.updateBusinessDNASettings(token, businessId, {
        name: state.name.trim(),
        industry: state.industry.trim(),
        tone: state.tone,
        services: state.services.map((s) => ({
          id: s.id ?? undefined,
          name: s.name.trim(),
          description: s.description.trim(),
          questions: s.questions.map((q) => q.trim()).filter(Boolean),
          commercial_path: s.commercialPath,
          quote_price: s.commercialPath === "quote" ? s.quotePrice.trim() : null,
          next_step_message: s.commercialPath === "direct_step" ? s.nextStepMessage.trim() : null,
          intake_keywords: s.intakeKeywords.split(",").map((item) => item.trim()).filter(Boolean),
        })),
        service_zip_codes: state.areaMode === "local" ? zipList : [],
        escalate_on_high_urgency: state.escalation.highUrgency,
        escalate_on_emergency: state.escalation.emergency,
        booking_enabled: state.bookingEnabled,
        booking_timezone: state.bookingTimezone,
        business_hours: WEEKDAYS.reduce((acc, day) => {
          const d = state.hours[day];
          if (d.open) acc[day] = [{ opens: d.opens, closes: d.closes }];
          return acc;
        }, {} as Record<string, { opens: string; closes: string }[]>),
        objection_responses: submittedObjections.map((o) => ({
          trigger_description: o.trigger.trim(),
          approved_response: o.response.trim(),
        })),
        compliance_disclaimer: state.complianceDisclaimer.trim(),
        ai_disclosure_text: state.aiDisclosureText.trim(),
      });
      const mapped = fromServer(dna);
      // Keep the client-only keys we already had (by position — the server returns
      // services/objections in the same order we submitted them) so inputs don't
      // remount and lose focus/selection right after a save.
      const services = mapped.services.map((s, i) => ({ ...s, key: state.services[i]?.key ?? s.key }));
      const objectionResponses = mapped.objectionResponses.map((o, i) => ({
        ...o,
        key: submittedObjections[i]?.key ?? o.key,
      }));
      const next = { ...mapped, services, objectionResponses };
      setState(next);
      setBaseline(next);
      setVersion(dna.version);
      setUpdatedAt(dna.updated_at);
      setWidgetSnippet(dna.widget_snippet);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setState(baseline);
    setSaveError(null);
  };

  const copyWidgetSnippet = async () => {
    if (!widgetSnippet) return;
    try {
      await navigator.clipboard.writeText(widgetSnippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (e.g. an insecure context) -- the
      // snippet is still fully visible and selectable in the box below, so
      // this is a silent no-op rather than an error state.
    }
  };

  return (
    <div className="ev-page min-h-screen w-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">
        <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/app")}
              aria-label="Back to Overview"
              className="md:hidden -ml-1.5 p-1.5 rounded-lg shrink-0"
              style={{ color: "#6B6459" }}
          >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-semibold">Settings</h1>
              <p className="text-sm text-mute mt-0.5" style={{ fontFamily: dirty ? "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" : "'IBM Plex Mono', monospace" }}>
                {dirty
                  ? "Unsaved changes"
                  : updatedAt
                    ? `Last updated ${formatRelativeTime(updatedAt)}${version ? ` · v${version}` : ""}`
                    : "Loading…"}
              </p>
            </div>
          </div>
          {!dirty && state && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full" style={{ color: "#1E7B52", backgroundColor: "#E9F5EF" }}>
              <Check size={12} /> Live
            </span>
          )}
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-mute py-16 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && loadError && (
          <div className="max-w-3xl px-6 md:px-8 py-8 w-full">
            <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
              {loadError}
            </div>
          </div>
        )}

        {!loading && !loadError && state && (
          <>
            <div className="max-w-3xl px-6 md:px-8 py-8 w-full">
              <div className="flex items-center gap-1 mb-8 border-b border-line">
                <button
                  onClick={() => scrollTabRail(-1)}
                  aria-label="Scroll tabs left"
                  className="md:hidden shrink-0 p-1 -mb-px"
                  style={{ color: "#9A8F83" }}
              >
                  <ChevronLeft size={16} />
                </button>
                <div ref={tabRailRef} className="flex items-center gap-1 overflow-x-auto scroll-smooth">
                  {SETTINGS_TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className="px-3.5 py-2.5 text-sm whitespace-nowrap relative -mb-px shrink-0"
                      style={{ color: tab === t.key ? "#0B0B0D" : "#9A8F83", fontWeight: tab === t.key ? 600 : 500 }}
                  >
                      {t.label}
                      {tab === t.key && <span className="absolute left-0 right-0 -bottom-px h-0.5" style={{ backgroundColor: "#0B0B0D" }} />}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => scrollTabRail(1)}
                  aria-label="Scroll tabs right"
                  className="md:hidden shrink-0 p-1 -mb-px"
                  style={{ color: "#9A8F83" }}
              >
                  <ChevronRight size={16} />
                </button>
              </div>

              {tab === "widget" && (
                <div>
                  <div className="rounded-2xl border p-5 md:p-6" style={{ borderColor: "#FF5A36", backgroundColor: "#FFE8E1" }}>
                    <div className="flex items-start gap-3 mb-5">
                      <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "#FF5A36", color: "#0B0B0D" }}>
                        <MessageSquare size={18} />
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold">Put Evorove on your website</h2>
                        <p className="text-sm text-mute mt-1 leading-relaxed">
                          Copy this code and paste it into your website just before <code>&lt;/body&gt;</code>. Once published, customers can start a conversation from any page.
                        </p>
                      </div>
                    </div>
                    <div className="relative">
                      <pre
                        className="text-xs p-4 pr-24 rounded-lg border overflow-x-auto bg-white"
                        style={{ borderColor: "#E4DCCB", fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                        <code>{widgetSnippet ?? "Loading…"}</code>
                      </pre>
                      <button
                        onClick={copyWidgetSnippet}
                        disabled={!widgetSnippet}
                        className="absolute top-2.5 right-2.5 text-xs font-medium px-3 py-2 rounded-md flex items-center gap-1.5 text-white disabled:opacity-50"
                        style={{ backgroundColor: "#0B0B0D" }}
                    >
                        {snippetCopied ? <Check size={13} /> : <Copy size={13} />}
                        {snippetCopied ? "Copied" : "Copy code"}
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                      <p className="text-xs text-mute">Using Wix, Squarespace, Webflow, WordPress, or another site builder? Add this as a custom code or HTML snippet.</p>
                      <a
                        href={`${API_BASE}/widget/demo.html?business_id=${encodeURIComponent(businessId ?? "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-white text-xs font-medium"
                    >
                        Preview widget <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>

                  {/* Lives here, not on the Statistics tab, because this is
                      the screen you are on when you test the widget and the
                      screen you come back to when you are ready to go live.
                      Nobody installing a widget opens a statistics tab. */}
                  <div className="rounded-2xl border p-5 mt-5" style={{ borderColor: "#E4DCCB" }}>
                    <h2 className="text-base font-semibold">Test mode</h2>
                    <p className="text-sm text-mute mt-1 leading-relaxed">
                      Keep this on while you test your widget. New conversations stay fully visible in your audit trail, but do not affect your statistics until you go live.
                    </p>
                    <label className="flex items-start gap-3 mt-5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reporting?.test_mode_enabled ?? false}
                        disabled={!reporting || reportingSaving}
                        onChange={(event) => updateReporting({ test_mode_enabled: event.target.checked })}
                        className="mt-0.5 accent-coral"
                      />
                      <span>
                        {/* The label used to read "Test mode is on" as a fixed
                            string beside a checkbox bound to the real state.
                            With the mode off, the screen said it was on. On
                            the switch that decides whether a firm's real
                            customer conversations count, that is not a
                            wording nit. */}
                        <span className="block text-sm font-medium">Test mode</span>
                        <span className="block text-xs text-mute mt-0.5">
                          {reporting?.test_mode_enabled
                            ? "On — new conversations stay out of your statistics. Turn it off when you are ready for real customers to count."
                            : "Off — new conversations count towards your statistics."}
                        </span>
                      </span>
                    </label>
                    {reporting?.test_mode_enabled && (
                      <button
                        onClick={() => updateReporting({ test_mode_enabled: false })}
                        disabled={reportingSaving}
                        className="mt-4 text-sm font-medium text-white px-4 py-2.5 rounded-lg disabled:opacity-50"
                        style={{ backgroundColor: "#0B0B0D" }}
                    >
                        Go live
                      </button>
                    )}
                    {reportingError && (
                      <div className="mt-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
                        {reportingError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === "basics" && (
                <div>
                  <Field label="Business name"><input className={inputCls} value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} /></Field>
                  <Field label="Industry"><input className={inputCls} value={state.industry} onChange={(e) => setState({ ...state, industry: e.target.value })} /></Field>
                  <Field label="How should it sound to customers?">
                    <div className="grid sm:grid-cols-3 gap-2.5">
                      {TONE_PRESETS.map((preset) => (
                        <ToneOption
                          key={preset.label}
                          label={preset.label}
                          desc={preset.desc}
                          active={state.tone === preset.copy}
                          onClick={() => setState({ ...state, tone: preset.copy })}
                        />
                      ))}
                    </div>
                  </Field>

                  <div className="text-sm font-semibold mt-8 mb-4 pt-6 border-t border-[#F0EFE9]">Who you serve</div>
                  <div className="grid sm:grid-cols-2 gap-3 mb-5">
                    <AreaOption
                      icon={Globe}
                      label="Serve customers anywhere"
                      desc="For remote, online, or nationwide businesses. Location never disqualifies a lead."
                      active={state.areaMode === "remote"}
                      onClick={() => setState({ ...state, areaMode: "remote" })}
                    />
                    <AreaOption
                      icon={MapPin}
                      label="Only selected ZIP codes"
                      desc="Use this when travel or licensing limits where you can serve. Leads outside the list won't book automatically."
                      active={state.areaMode === "local"}
                      onClick={() => setState({ ...state, areaMode: "local" })}
                    />
                  </div>
                  {state.areaMode === "local" && (
                    <Field label="Known service zip codes" hint="Comma-separated — the engine matches a customer's stated zip against these first, and treats anything else as outside your area.">
                      <textarea className={inputCls} rows={3} value={state.zips} onChange={(e) => setState({ ...state, zips: e.target.value })} />
                      {zipList.length === 0 && <p className="text-xs mt-2" style={{ color: "#B4483A" }}>At least one zip code is required.</p>}
                    </Field>
                  )}
                </div>
              )}

              {tab === "services" && (
                <div>
                  <Field label="What you offer" hint="These are what it books, quotes, and answers questions about.">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {state.services.map((s) => (
                        <span key={s.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-[#F1F1EF] border border-line">
                          {s.name} <X size={12} className="cursor-pointer text-clay" onClick={() => removeService(s.key)} />
                        </span>
                      ))}
                      {state.services.length === 0 && <span className="text-xs text-clay">No services yet — add at least one.</span>}
                    </div>
                    <div className="flex gap-2">
                      <input className={inputCls} placeholder="Add a service" value={newService} onChange={(e) => setNewService(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addService())} />
                      <button onClick={addService} className="px-4 rounded-lg text-white text-sm font-medium flex items-center gap-1.5 shrink-0" style={{ backgroundColor: "#0B0B0D" }}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </Field>

                  <div className="text-sm font-semibold mt-8 mb-2 pt-6 border-t border-[#F0EFE9]">Online booking</div>
                  <p className="text-sm text-mute mb-6">
                    Let clients pick a real open slot and get booked automatically — no back-and-forth.
                    Only services set to "Book online" below are offered a slot; this needs to be on
                    for that to actually happen.
                  </p>
                  <label className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer mb-6" style={{ borderColor: state.bookingEnabled ? "#FF5A36" : "#E4DCCB", backgroundColor: state.bookingEnabled ? "#FFE8E1" : "#fff" }}>
                    <input
                      type="checkbox"
                      checked={state.bookingEnabled}
                      onChange={() => setState({ ...state, bookingEnabled: !state.bookingEnabled })}
                      className="mt-0.5 accent-coral"
                    />
                    <div>
                      <div className="text-sm font-medium">Turn on online booking</div>
                      <div className="text-xs text-mute mt-0.5">Off by default — until this is on, every qualified lead still goes to you instead of getting a slot.</div>
                    </div>
                  </label>

                  <Field label="What happens once a lead qualifies for each service?" hint="Book online offers a real slot. Send a price quote gives an automatic fixed price. Send next steps replies with instructions instead of a price or a slot. Always hand off to you sends every qualified lead your way.">
                    <div className="flex flex-col gap-4">
                      {state.services.length === 0 && <span className="text-xs text-clay">Add a service above first.</span>}
                      {state.services.map((s) => (
                        <div key={s.key} className="p-3 rounded-xl border border-line">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-sm font-medium min-w-0 flex-1">{s.name}</span>
                            <select
                              className={inputCls}
                              style={{ width: "auto", minWidth: 200 }}
                              value={s.commercialPath}
                              onChange={(e) => {
                                const commercialPath = e.target.value as CommercialPath;
                                const services = state.services.map((svc) =>
                                  svc.key === s.key ? { ...svc, commercialPath } : svc,
                                );
                                setState({ ...state, services });
                              }}
                          >
                              {COMMERCIAL_PATH_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                          {s.commercialPath === "quote" && (
                            <div className="mt-3">
                              <label className="text-xs text-mute block mb-1">Fixed price ($)</label>
                              <input
                                className={inputCls}
                                style={{ width: 160 }}
                                placeholder="e.g. 150"
                                inputMode="decimal"
                                value={s.quotePrice}
                                onChange={(e) => {
                                  const services = state.services.map((svc) =>
                                    svc.key === s.key ? { ...svc, quotePrice: e.target.value } : svc,
                                  );
                                  setState({ ...state, services });
                                }}
                              />
                              {!QUOTE_PRICE_PATTERN.test(s.quotePrice.trim()) && (
                                <p className="text-xs mt-1.5" style={{ color: "#B4483A" }}>Enter a price like 150 or 89.50.</p>
                              )}
                            </div>
                          )}
                          {s.commercialPath === "direct_step" && (
                            <div className="mt-3">
                              <label className="text-xs text-mute block mb-1">Message to send</label>
                              <textarea
                                className={inputCls}
                                rows={2}
                                placeholder="e.g. Head to our online store to place your order: ..."
                                value={s.nextStepMessage}
                                onChange={(e) => {
                                  const services = state.services.map((svc) =>
                                    svc.key === s.key ? { ...svc, nextStepMessage: e.target.value } : svc,
                                  );
                                  setState({ ...state, services });
                                }}
                              />
                              {s.nextStepMessage.trim().length === 0 && (
                                <p className="text-xs mt-1.5" style={{ color: "#B4483A" }}>A message is required.</p>
                              )}
                            </div>
                          )}
                          <div className="mt-3">
                            <label className="text-xs text-mute block mb-1">What this service is</label>
                            <textarea
                              className={inputCls}
                              rows={2}
                              maxLength={500}
                              placeholder="Plain language the engine uses to match what a customer asked for"
                              value={s.description}
                              onChange={(e) => {
                                const services = state.services.map((svc) =>
                                  svc.key === s.key ? { ...svc, description: e.target.value } : svc,
                                );
                                setState({ ...state, services });
                              }}
                            />
                          </div>
                          <div className="mt-3">
                            <label className="text-xs text-mute block mb-1">Matching phrases</label>
                            <input
                              className={inputCls}
                              placeholder="e.g. consult, intake, first meeting"
                              value={s.intakeKeywords}
                              onChange={(e) => {
                                const services = state.services.map((svc) =>
                                  svc.key === s.key ? { ...svc, intakeKeywords: e.target.value } : svc,
                                );
                                setState({ ...state, services });
                              }}
                            />
                            <p className="text-xs text-clay mt-1.5">Optional extra words the engine uses to match this service. The service name is always included.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Field>

                  <Field label="Time zone" hint="Slot times are calculated in this zone.">
                    <select
                      className={inputCls}
                      value={state.bookingTimezone}
                      onChange={(e) => setState({ ...state, bookingTimezone: e.target.value })}
                  >
                      <optgroup label="United States">
                        {US_TIMEZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </optgroup>
                      {WORLD_TIMEZONES.length > 0 && (
                        <optgroup label="All time zones">
                          {WORLD_TIMEZONES.map((tz) => (
                            <option key={tz.value} value={tz.value}>{tz.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </Field>

                  <Field label="Open hours" hint="Uncheck a day to keep it closed. Slots are only offered inside these windows.">
                    <div className="flex flex-col gap-2">
                      {WEEKDAYS.map((day) => {
                        const d = state.hours[day];
                        return (
                          <div key={day} className="flex items-center gap-3">
                            <label className="flex items-center gap-2 w-24 shrink-0 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={d.open}
                                onChange={() => setState({ ...state, hours: { ...state.hours, [day]: { ...d, open: !d.open } } })}
                                className="accent-coral"
                              />
                              {WEEKDAY_LABELS[day]}
                            </label>
                            <input
                              type="time"
                              className={inputCls}
                              disabled={!d.open}
                              value={d.opens}
                              onChange={(e) => setState({ ...state, hours: { ...state.hours, [day]: { ...d, opens: e.target.value } } })}
                            />
                            <span className="text-xs text-clay">to</span>
                            <input
                              type="time"
                              className={inputCls}
                              disabled={!d.open}
                              value={d.closes}
                              onChange={(e) => setState({ ...state, hours: { ...state.hours, [day]: { ...d, closes: e.target.value } } })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              )}

              {tab === "conversation" && (
                <div>
                  <p className="text-sm text-mute mb-6">Per service, the questions your engine confirms before booking.</p>
                  <Field label="AI disclosure" hint="Shown in the chat header for the whole session. Required in CA/NY when the visitor is talking to AI.">
                    <input
                      className={inputCls}
                      maxLength={200}
                      placeholder="AI assistant, not a lawyer"
                      value={state.aiDisclosureText}
                      onChange={(e) => setState({ ...state, aiDisclosureText: e.target.value })}
                    />
                  </Field>
                  <Field label="Compliance line" hint="Appended to every outbound customer message. Leave blank if you do not need one.">
                    <textarea
                      className={inputCls}
                      rows={2}
                      maxLength={1000}
                      placeholder="I'm an AI assistant. This is not legal advice."
                      value={state.complianceDisclaimer}
                      onChange={(e) => setState({ ...state, complianceDisclaimer: e.target.value })}
                    />
                  </Field>
                  {state.services.length === 0 && <p className="text-sm text-clay">Add a service on the Services & booking tab first.</p>}
                  {state.services.map((svc) => (
                    <div key={svc.key} className="mb-5 pb-5 border-b border-[#F0EFE9] last:border-0">
                      <div className="text-sm font-semibold mb-2.5">{svc.name}</div>
                      <div className="flex flex-col gap-2">
                        {svc.questions.map((q, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-clay w-5 shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{i + 1}</span>
                            <input
                              className={inputCls}
                              value={q}
                              onChange={(e) => {
                                const services = state.services.map((s) =>
                                  s.key === svc.key ? { ...s, questions: s.questions.map((qq, qi) => (qi === i ? e.target.value : qq)) } : s,
                                );
                                setState({ ...state, services });
                              }}
                            />
                            <X
                              size={14}
                              className="cursor-pointer text-clay shrink-0"
                              onClick={() => {
                                const services = state.services.map((s) =>
                                  s.key === svc.key ? { ...s, questions: s.questions.filter((_, qi) => qi !== i) } : s,
                                );
                                setState({ ...state, services });
                              }}
                            />
                          </div>
                        ))}
                        <button
                          className="text-xs font-medium text-coral flex items-center gap-1 mt-0.5 ml-7"
                          onClick={() => {
                            const services = state.services.map((s) => (s.key === svc.key ? { ...s, questions: [...s.questions, ""] } : s));
                            setState({ ...state, services });
                          }}
                      >
                          <Plus size={12} /> Add question
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="text-sm font-semibold mt-8 mb-2 pt-6 border-t border-[#F0EFE9]">Objections</div>
                  <p className="text-sm text-mute mb-4">
                    When a customer pushes back — price, timing, whether this fits their situation — the engine
                    picks the closest match below and rewords it for the moment. It never writes its own answer,
                    only yours. Leave this empty and objections are handled like any other message.
                  </p>
                  {state.objectionResponses.map((o) => (
                    <div key={o.key} className="mb-4 p-4 rounded-xl border border-line">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 flex flex-col gap-2.5">
                          <div>
                            <label className="text-xs text-mute block mb-1">What the customer is objecting to</label>
                            <input
                              className={inputCls}
                              placeholder="e.g. price pushback"
                              value={o.trigger}
                              maxLength={300}
                              onChange={(e) => updateObjection(o.key, "trigger", e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-mute block mb-1">Your approved response</label>
                            <textarea
                              className={inputCls}
                              rows={2}
                              maxLength={800}
                              placeholder="e.g. We charge a flat rate for the first visit, no surprises."
                              value={o.response}
                              onChange={(e) => updateObjection(o.key, "response", e.target.value)}
                            />
                          </div>
                          {(o.trigger.trim().length > 0) !== (o.response.trim().length > 0) && (
                            <p className="text-xs" style={{ color: "#B4483A" }}>
                              Fill in both fields, or remove this entry.
                            </p>
                          )}
                        </div>
                        <X
                          size={14}
                          className="cursor-pointer text-clay shrink-0 mt-1"
                          onClick={() => removeObjection(o.key)}
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    className="text-xs font-medium text-coral flex items-center gap-1"
                    onClick={addObjection}
                >
                    <Plus size={12} /> Add objection
                  </button>

                  <div className="text-sm font-semibold mt-8 mb-2 pt-6 border-t border-[#F0EFE9]">Escalation</div>
                  <p className="text-sm text-mute mb-4">The engine never guesses past these lines — it stops and asks.</p>
                  <div className="flex flex-col gap-3">
                    {ESCALATION_OPTIONS.map(([key, title, desc]) => (
                      <label
                        key={key}
                        className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer"
                        style={{ borderColor: state.escalation[key] ? "#FF5A36" : "#E4DCCB", backgroundColor: state.escalation[key] ? "#FFE8E1" : "#fff" }}
                    >
                        <input
                          type="checkbox"
                          checked={state.escalation[key]}
                          onChange={() => setState({ ...state, escalation: { ...state.escalation, [key]: !state.escalation[key] } })}
                          className="mt-0.5 accent-coral"
                        />
                        <div>
                          <div className="text-sm font-medium">{title}</div>
                          <div className="text-xs text-mute mt-0.5">{desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {tab === "playbook" && token && businessId && (
                <SalesPlaybookSettings token={token} businessId={businessId} />
              )}

              {tab === "reporting" && (
                <div>
                  {reporting?.test_mode_enabled && (
                    <div className="rounded-2xl border p-4 mb-5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderColor: "#E8CFAF", backgroundColor: "#FFF8EE" }}>
                      <span className="text-sm font-medium text-[#8A561B]">Test mode is on.</span>
                      <span className="text-sm text-mute">New conversations are not counted here.</span>
                      <button
                        type="button"
                        onClick={() => setTab("widget")}
                        className="text-sm font-medium text-ink underline"
                    >
                        Change it in Install widget
                      </button>
                    </div>
                  )}
                  {token && businessId && (
                    <StatisticsPanel
                      token={token}
                      businessId={businessId}
                      reporting={reporting}
                      reportingSaving={reportingSaving}
                      reportingError={reportingError}
                      onUpdateReporting={updateReporting}
                    />
                  )}
                </div>
              )}

              {tab === "sms" && (
                <div>
                  <p className="text-sm text-mute mb-6">
                    Give leads a phone number that texts straight into your engine — the same qualification and
                    booking logic that runs on your website runs here too.
                  </p>
                  {smsLoading && (
                    <div className="flex items-center gap-2 text-sm text-mute py-6">
                      <Loader2 size={16} className="animate-spin" /> Checking status…
                    </div>
                  )}
                  {!smsLoading && smsStatus && !smsStatus.configured && (
                    <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#F1F1EF", color: "#6B6459" }}>
                      SMS delivery isn't set up on this deployment yet.
                    </div>
                  )}
                  {!smsLoading && smsStatus?.configured && smsStatus.phone_number && (
                    <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ borderColor: "#E4DCCB" }}>
                      <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 36, height: 36, backgroundColor: "#E9F5EF", color: "#1E7B52" }}>
                        <MessageSquare size={16} />
                      </span>
                      <div>
                        <div className="text-sm font-medium" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{smsStatus.phone_number}</div>
                        <div className="text-xs text-mute mt-0.5">Texts to this number reach your engine automatically.</div>
                      </div>
                    </div>
                  )}
                  {!smsLoading && smsStatus?.configured && !smsStatus.phone_number && (
                    <div className="p-4 rounded-xl border border-line">
                      <div className="text-sm font-medium mb-1">No number yet</div>
                      <div className="text-xs text-mute mb-3">Set up a dedicated SMS number for your business — this takes a few seconds.</div>
                      <button
                        onClick={provisionSms}
                        disabled={smsProvisioning}
                        className="text-sm font-medium text-white px-4 py-2.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                        style={{ backgroundColor: "#0B0B0D" }}
                    >
                        {smsProvisioning && <Loader2 size={13} className="animate-spin" />}
                        Set up SMS
                      </button>
                    </div>
                  )}
                  {smsError && (
                    <div className="mt-3 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-3" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
                      <span>{smsError}</span>
                      {smsStatus?.configured && (
                        <button onClick={provisionSms} disabled={smsProvisioning} className="text-xs font-medium underline shrink-0 disabled:opacity-50">
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === "crm" && (
                <div>
                  <p className="text-sm text-mute mb-6">
                    Send a public HTTPS ping to Zapier, Make, or your CRM when a conversation becomes qualified or won.
                    The saved URL is treated as a secret and is never shown again after you save it.
                  </p>
                  {crmLoading && (
                    <div className="flex items-center gap-2 text-sm text-mute py-6">
                      <Loader2 size={16} className="animate-spin" /> Checking status…
                    </div>
                  )}
                  {!crmLoading && crmStatus?.configured && (
                    <div className="px-4 py-3 rounded-lg text-sm mb-4" style={{ backgroundColor: "#E9F5EF", color: "#1E7B52" }}>
                      A CRM webhook is configured. Enter a new URL below to replace it.
                    </div>
                  )}
                  <Field label="Webhook URL" hint="Must be public HTTPS. Private or localhost addresses are rejected.">
                    <input
                      className={inputCls}
                      type="url"
                      placeholder="https://hooks.zapier.com/..."
                      value={crmUrl}
                      onChange={(e) => setCrmUrl(e.target.value)}
                    />
                  </Field>
                  {crmError && (
                    <div className="mt-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
                      {crmError}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      disabled={crmSaving || !crmUrl.trim()}
                      onClick={async () => {
                        if (!token || !businessId) return;
                        setCrmSaving(true);
                        setCrmError(null);
                        try {
                          const status = await api.configureCrmWebhook(token, businessId, crmUrl.trim());
                          setCrmStatus(status);
                          setCrmUrl("");
                        } catch (err) {
                          setCrmError(describeError(err));
                        } finally {
                          setCrmSaving(false);
                        }
                      }}
                      className="text-sm font-medium text-white px-4 py-2.5 rounded-lg disabled:opacity-50"
                      style={{ backgroundColor: "#0B0B0D" }}
                  >
                      {crmSaving ? "Saving…" : "Save webhook"}
                    </button>
                    {crmStatus?.configured && (
                      <button
                        disabled={crmSaving}
                        onClick={async () => {
                          if (!token || !businessId) return;
                          setCrmSaving(true);
                          setCrmError(null);
                          try {
                            const status = await api.removeCrmWebhook(token, businessId);
                            setCrmStatus(status);
                          } catch (err) {
                            setCrmError(describeError(err));
                          } finally {
                            setCrmSaving(false);
                          }
                        }}
                        className="text-sm font-medium px-4 py-2.5 rounded-lg border border-line"
                    >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {dirty && (
              <div className="sticky bottom-0 border-t border-line bg-white px-6 md:px-8 py-4 flex items-center justify-between gap-4">
                <span className="text-xs text-mute">
                  {saveError ?? "This won't change how existing conversations behave — only new ones."}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={discard} disabled={saving} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-line flex items-center gap-1.5 disabled:opacity-50">
                    <RotateCcw size={13} /> Discard
                  </button>
                  <button onClick={save} disabled={!canSave || saving} className="text-sm font-medium text-white px-5 py-2.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50" style={{ backgroundColor: "#0B0B0D" }}>
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    Save changes
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
