import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type DashboardAnalytics,
  type DashboardCaseSummary,
  type DashboardConversationSummary,
  type ReportingSettings,
  type ReportingSettingsUpdate,
} from "../api/client";
import { describeError } from "../auth/AuthContext";
import { isoToUs, usToIso } from "../lib/usDate";
import {
  CONVERSATION_STATUS_LABELS,
  ESCALATION_ACTIONS,
  ESCALATION_FEEDBACK_LABELS,
  ESCALATION_LABELS,
} from "../lib/escalationCopy";
import { STATE_META, mapProcessState, formatRelativeTime, type CaseState } from "./Shared";

function UsDateField({ label, value, min, onChange }: {
  label: string;
  value: string;
  min?: string;
  onChange: (iso: string) => void;
}) {
  const [text, setText] = useState(() => isoToUs(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(isoToUs(value));
    setInvalid(false);
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setInvalid(false);
      onChange("");
      return;
    }
    const iso = usToIso(trimmed);
    if (!iso || (min && iso < min)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(iso);
  };

  return (
    <label className="text-xs text-mute flex flex-col gap-1">
      {label}
      <input
        type="text"
        inputMode="numeric"
        lang="en-US"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        aria-label={`${label} date, month slash day slash year`}
        aria-invalid={invalid}
        value={text}
        onChange={(event) => { setText(event.target.value); setInvalid(false); }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") commit((event.target as HTMLInputElement).value); }}
        className="w-[118px] px-2.5 py-2 rounded-lg border text-sm text-ink outline-none"
        style={{ borderColor: invalid ? "#B4483A" : "#E4DCCB" }}
      />
    </label>
  );
}

function StatCard({ label, value, sub, tone, emphasis = false }: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 min-w-0 ${emphasis ? "border-lime bg-lime-wash" : "border-line bg-white"}`}>
      <div className="font-medium text-mute text-[11px] leading-tight mb-1">{label}</div>
      <span className="ev-display text-[28px] leading-none block">
        {value}
      </span>
      {sub && (
        <span className="text-[11px] leading-tight block mt-1 break-words font-medium" style={{ color: tone || "#6B6459" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

type LeadSort = "date" | "name" | "state" | "category";
type ConversationSort = "date" | "name" | "status" | "channel";
type SortDirection = "asc" | "desc";

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-left font-medium"
      style={{ color: active ? "#0B0B0D" : "#6B6459" }}
  >
      {label}
      {active && (direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
}

function inPeriod(iso: string, startDate: string, endDate: string): boolean {
  const day = iso.slice(0, 10);
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

export function StatisticsPanel({
  token,
  businessId,
  reporting,
  reportingSaving,
  reportingError,
  onUpdateReporting,
}: {
  token: string;
  businessId: string;
  reporting: ReportingSettings | null;
  reportingSaving: boolean;
  reportingError: string | null;
  onUpdateReporting: (update: ReportingSettingsUpdate) => Promise<boolean | void>;
}) {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [cases, setCases] = useState<DashboardCaseSummary[] | null>(null);
  const [conversations, setConversations] = useState<DashboardConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [includeTestData, setIncludeTestData] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [leadSort, setLeadSort] = useState<LeadSort>("date");
  const [leadDirection, setLeadDirection] = useState<SortDirection>("desc");
  const [conversationSort, setConversationSort] = useState<ConversationSort>("date");
  const [conversationDirection, setConversationDirection] = useState<SortDirection>("desc");
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [leadStateFilter, setLeadStateFilter] = useState<CaseState | "ALL">("ALL");
  const [conversationStatusFilter, setConversationStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const scope = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      includeTest: includeTestData,
    };
    Promise.all([
      api.getDashboardAnalytics(token, businessId, scope),
      api.listCases(token, businessId, scope),
      api.listConversations(token, businessId),
    ])
      .then(([nextAnalytics, caseList, conversationList]) => {
        if (cancelled) return;
        setAnalytics(nextAnalytics);
        setCases(caseList.cases);
        setConversations(conversationList.conversations);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId, startDate, endDate, includeTestData, statsVersion]);

  const decoratedLeads = useMemo(
    () =>
      (cases ?? []).map((c) => {
        const { caseState } = mapProcessState(c.current_state);
        const followUpDue = ["QUALIFYING", "FOLLOW_UP"].includes(c.current_state)
          && Date.now() - new Date(c.updated_at).getTime() > 24 * 60 * 60 * 1000;
        return { ...c, caseState, followUpDue };
      }),
    [cases],
  );

  const periodConversations = useMemo(
    () =>
      (conversations ?? []).filter((conversation) => {
        if (!includeTestData) {
          const linked = (cases ?? []).find((c) => c.case_id === conversation.case_id);
          if (linked?.is_test) return false;
        }
        return inPeriod(conversation.last_activity_at, startDate, endDate);
      }),
    [conversations, cases, includeTestData, startDate, endDate],
  );

  const conversationCounts = useMemo(() => {
    const counts = { total: 0, needsYou: 0, engine: 0, closed: 0, sms: 0, web: 0 };
    periodConversations.forEach((conversation) => {
      counts.total += 1;
      if (conversation.status === "human_takeover_requested" || conversation.status === "human_takeover_active") counts.needsYou += 1;
      if (conversation.status === "ai_active") counts.engine += 1;
      if (conversation.status === "closed") counts.closed += 1;
      if (conversation.channel === "sms") counts.sms += 1;
      else counts.web += 1;
    });
    return counts;
  }, [periodConversations]);

  const attention = useMemo(() => {
    const needsHuman = decoratedLeads.filter((c) => c.caseState === "NEEDS_HUMAN").length;
    const followUpDue = decoratedLeads.filter((c) => c.followUpDue).length;
    return { needsHuman, followUpDue };
  }, [decoratedLeads]);

  const sortedLeads = useMemo(() => {
    const visible = decoratedLeads.filter((c) => {
      if (followUpOnly && !c.followUpDue) return false;
      if (reasonFilter !== null && c.escalation_reason !== reasonFilter) return false;
      if (leadStateFilter !== "ALL" && c.caseState !== leadStateFilter) return false;
      return true;
    });
    return visible.sort((left, right) => {
      let comparison = 0;
      if (leadSort === "date") comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      else if (leadSort === "name") comparison = (left.lead.name || "").localeCompare(right.lead.name || "", undefined, { sensitivity: "base" });
      else if (leadSort === "state") comparison = left.caseState.localeCompare(right.caseState);
      else comparison = (left.category || "").localeCompare(right.category || "", undefined, { sensitivity: "base" });
      return leadDirection === "asc" ? comparison : -comparison;
    });
  }, [decoratedLeads, followUpOnly, reasonFilter, leadStateFilter, leadSort, leadDirection]);

  const sortedConversations = useMemo(() => {
    const visible = periodConversations.filter((conversation) => (
      conversationStatusFilter === "ALL" || conversation.status === conversationStatusFilter
    ));
    return visible.sort((left, right) => {
      let comparison = 0;
      if (conversationSort === "date") comparison = new Date(left.last_activity_at).getTime() - new Date(right.last_activity_at).getTime();
      else if (conversationSort === "name") comparison = (left.lead_name || "").localeCompare(right.lead_name || "", undefined, { sensitivity: "base" });
      else if (conversationSort === "status") comparison = left.status.localeCompare(right.status);
      else comparison = left.channel.localeCompare(right.channel);
      return conversationDirection === "asc" ? comparison : -comparison;
    });
  }, [periodConversations, conversationStatusFilter, conversationSort, conversationDirection]);

  const toggleLeadSort = (next: LeadSort) => {
    if (leadSort === next) setLeadDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setLeadSort(next);
      setLeadDirection(next === "name" || next === "category" ? "asc" : "desc");
    }
  };

  const toggleConversationSort = (next: ConversationSort) => {
    if (conversationSort === next) setConversationDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setConversationSort(next);
      setConversationDirection(next === "name" || next === "status" || next === "channel" ? "asc" : "desc");
    }
  };

  const resetStatistics = async () => {
    const ok = await onUpdateReporting({ reset_statistics: true });
    setConfirmingReset(false);
    if (ok !== false) setStatsVersion((current) => current + 1);
  };

  const restoreHistory = async () => {
    const ok = await onUpdateReporting({ clear_statistics_baseline: true });
    if (ok !== false) setStatsVersion((current) => current + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border p-5" style={{ borderColor: "#E4DCCB" }}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold">Reporting period</h2>
            <p className="text-sm text-mute mt-1">Filter every figure and table below by when the lead or conversation was created.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <UsDateField label="From" value={startDate} onChange={setStartDate} />
            <UsDateField label="To" value={endDate} min={startDate} onChange={setEndDate} />
            {(startDate || endDate) && (
              <button type="button" onClick={() => { setStartDate(""); setEndDate(""); }} className="text-xs font-medium px-3 py-2 rounded-lg border border-line hover:border-coral transition-colors">
                All time
              </button>
            )}
          </div>
        </div>
        {analytics && analytics.hidden_test_cases > 0 && (
          <label className="text-xs text-mute flex items-center gap-2 mb-4">
            <input type="checkbox" checked={includeTestData} onChange={(event) => setIncludeTestData(event.target.checked)} className="accent-coral" />
            {includeTestData
              ? "Including test data"
              : `Test data hidden · ${analytics.hidden_test_conversations} conversations / ${analytics.hidden_test_cases} cases`}
          </label>
        )}
        <h3 className="text-sm font-semibold mb-1">Statistics baseline</h3>
        <p className="text-sm text-mute leading-relaxed">
          Resetting starts these metrics from now. It never deletes conversations, cases, or audit events. You can restore the full history at any time.
        </p>
        <p className="text-xs text-mute mt-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {reporting?.stats_since ? `Counting cases created since ${new Date(reporting.stats_since).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Counting all retained history"}
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          {confirmingReset ? (
            <>
              <button type="button" onClick={() => void resetStatistics()} disabled={reportingSaving} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-coral text-coral-deep bg-coral-wash disabled:opacity-50">
                {reportingSaving ? "Resetting…" : "Confirm reset"}
              </button>
              <button type="button" onClick={() => setConfirmingReset(false)} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-line">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingReset(true)} disabled={!reporting || reportingSaving} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-line disabled:opacity-50">
              Reset statistics
            </button>
          )}
          {reporting?.stats_since && (
            <button type="button" onClick={() => void restoreHistory()} disabled={reportingSaving} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-line disabled:opacity-50">
              Restore full history
            </button>
          )}
        </div>
        {reportingError && (
          <div className="mt-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
            {reportingError}
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
          Couldn't load statistics: {error}
        </div>
      )}

      {cases === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-mute py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading statistics…
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-base font-semibold mb-3">Leads</h2>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
              <StatCard label="Leads in period" value={analytics?.total_cases ?? decoratedLeads.length} sub="counted cases" />
              <StatCard label="Qualifying now" value={decoratedLeads.filter((c) => c.caseState === "QUALIFYING").length} sub="active leads" tone="#FF5A36" />
              <StatCard label="Booked" value={analytics?.booked_cases ?? 0} sub="ever booked" tone="#1E7B52" />
              <StatCard label="Booking rate" value={analytics ? `${Math.round(analytics.booking_conversion_rate * 100)}%` : "—"} sub={analytics ? `${analytics.booked_cases}/${analytics.total_cases} leads` : undefined} tone="#1E7B52" />
              <StatCard label="Lost rate" value={analytics ? `${Math.round(analytics.lost_rate * 100)}%` : "—"} sub={analytics ? `${analytics.lost_cases}/${analytics.total_cases} leads` : undefined} />
              <StatCard label="Escalation rate" value={analytics ? `${Math.round(analytics.escalation_rate * 100)}%` : "—"} sub={analytics ? `${analytics.escalated_cases}/${analytics.total_cases} leads` : undefined} tone="#FF5A36" />
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold mb-3">Conversations</h2>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
              <StatCard label="Conversations in period" value={conversationCounts.total} sub="by last activity" />
              <StatCard label="Engine handling" value={conversationCounts.engine} sub="AI still on the thread" />
              <StatCard label="Needs you" value={conversationCounts.needsYou} sub="takeover requested or active" tone="#4A4A00" emphasis={conversationCounts.needsYou > 0} />
              <StatCard label="Closed" value={conversationCounts.closed} />
              <StatCard label="Website" value={conversationCounts.web} sub="web chat" />
              <StatCard label="SMS" value={conversationCounts.sms} sub="text message" />
              <StatCard
                label="Median first response"
                value={analytics?.median_first_response_seconds != null ? `${Math.round(analytics.median_first_response_seconds)}s` : "—"}
                sub={analytics ? `${analytics.response_samples} samples` : undefined}
                tone="#1E7B52"
              />
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ borderColor: "#E4DCCB" }}>
            <h2 className="text-base font-semibold">What to pay attention to</h2>
            <p className="text-sm text-mute mt-1 mb-4">Open a row to act on it, or filter the tables below.</p>
            <div className="grid gap-2 sm:grid-cols-2 mb-4">
              <button type="button" onClick={() => { setLeadStateFilter("NEEDS_HUMAN"); setFollowUpOnly(false); setReasonFilter(null); }} className="text-left">
                <StatCard label="Needs your attention" value={attention.needsHuman} sub="review queue" tone="#4A4A00" emphasis={attention.needsHuman > 0} />
              </button>
              <button type="button" onClick={() => { setLeadStateFilter("ALL"); setFollowUpOnly(true); setReasonFilter(null); }} className="text-left">
                <StatCard label="Follow-up due" value={attention.followUpDue} sub="waiting 24h+" tone="#C73618" />
              </button>
            </div>
            {analytics && Object.keys(analytics.escalation_reasons).length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-clay mb-2">Why leads were escalated</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(analytics.escalation_reasons)
                    .sort(([, left], [, right]) => right - left)
                    .map(([reason, count]) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => {
                          setFollowUpOnly(false);
                          setLeadStateFilter("NEEDS_HUMAN");
                          setReasonFilter(reasonFilter === reason ? null : reason);
                        }}
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium border"
                        style={{
                          backgroundColor: reasonFilter === reason ? "#FFE8E1" : "#fff",
                          borderColor: reasonFilter === reason ? "#FF5A36" : "#E4DCCB",
                        }}
                    >
                        {ESCALATION_LABELS[reason] ?? "Human review"} {count}
                      </button>
                    ))}
                </div>
                {reasonFilter && (
                  <p className="text-sm text-mute mt-3">
                    Next safe action: {ESCALATION_ACTIONS[reasonFilter] ?? "Open the lead and choose the next safe step."}
                  </p>
                )}
              </div>
            )}
            {analytics && Object.values(analytics.escalation_feedback).some((count) => count > 0) && (
              <div>
                <div className="text-xs font-medium text-clay mb-2">Staff feedback on escalations</div>
                <ul className="text-sm text-mute space-y-1">
                  {Object.entries(analytics.escalation_feedback)
                    .filter(([, count]) => count > 0)
                    .map(([key, count]) => (
                      <li key={key}>{ESCALATION_FEEDBACK_LABELS[key] ?? key}: {count}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-line overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Leads in this period ({sortedLeads.length})</h2>
              <div className="flex flex-wrap gap-1.5">
                {(["ALL", "NEEDS_HUMAN", "QUALIFYING", "BOOKED", "LOST", "COMPLETED"] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() => { setLeadStateFilter(state); setFollowUpOnly(false); if (state !== "NEEDS_HUMAN") setReasonFilter(null); }}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: leadStateFilter === state && !followUpOnly ? "#FFE8E1" : "transparent", color: leadStateFilter === state && !followUpOnly ? "#FF5A36" : "#6B6459" }}
                >
                    {state === "ALL" ? "All" : STATE_META[state].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide border-b border-line">
                    <th className="text-left px-5 py-2 font-medium"><SortButton label="Lead" active={leadSort === "name"} direction={leadDirection} onClick={() => toggleLeadSort("name")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="Added" active={leadSort === "date"} direction={leadDirection} onClick={() => toggleLeadSort("date")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="State" active={leadSort === "state"} direction={leadDirection} onClick={() => toggleLeadSort("state")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="Service" active={leadSort === "category"} direction={leadDirection} onClick={() => toggleLeadSort("category")} /></th>
                    <th className="text-left px-3 py-2 font-medium text-mute">Attention</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeads.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-mute">No leads in this period match the filters.</td></tr>
                  )}
                  {sortedLeads.map((c) => (
                    <tr key={c.case_id} className="border-b border-[#F0EFE9] last:border-0 cursor-pointer hover:bg-[#FAFAF7]" onClick={() => navigate(`/app/conversations?case=${c.case_id}`)}>
                      <td className="px-5 py-3 font-medium">{c.lead.name || "Unnamed lead"}</td>
                      <td className="px-3 py-3 text-mute">{formatRelativeTime(c.created_at)}</td>
                      <td className="px-3 py-3">{STATE_META[c.caseState].label}</td>
                      <td className="px-3 py-3 text-mute">{c.category || "Uncategorized"}</td>
                      <td className="px-3 py-3 text-mute">
                        {c.followUpDue ? "Follow-up overdue" : (ESCALATION_LABELS[c.escalation_reason ?? ""] ?? (c.escalation_reason ? "Needs review" : "—"))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-line overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Conversations in this period ({sortedConversations.length})</h2>
              <div className="flex flex-wrap gap-1.5">
                {["ALL", "ai_active", "human_takeover_requested", "human_takeover_active", "closed"].map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setConversationStatusFilter(status)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: conversationStatusFilter === status ? "#FFE8E1" : "transparent", color: conversationStatusFilter === status ? "#FF5A36" : "#6B6459" }}
                >
                    {status === "ALL" ? "All" : CONVERSATION_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide border-b border-line">
                    <th className="text-left px-5 py-2 font-medium"><SortButton label="Lead" active={conversationSort === "name"} direction={conversationDirection} onClick={() => toggleConversationSort("name")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="Activity" active={conversationSort === "date"} direction={conversationDirection} onClick={() => toggleConversationSort("date")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="Status" active={conversationSort === "status"} direction={conversationDirection} onClick={() => toggleConversationSort("status")} /></th>
                    <th className="text-left px-3 py-2 font-medium"><SortButton label="Channel" active={conversationSort === "channel"} direction={conversationDirection} onClick={() => toggleConversationSort("channel")} /></th>
                    <th className="text-left px-3 py-2 font-medium text-mute">Attention</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedConversations.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-mute">No conversations in this period match the filters.</td></tr>
                  )}
                  {sortedConversations.map((conversation) => (
                    <tr key={conversation.conversation_id} className="border-b border-[#F0EFE9] last:border-0 cursor-pointer hover:bg-[#FAFAF7]" onClick={() => navigate(conversation.case_id ? `/app/conversations?case=${conversation.case_id}` : "/app/conversations")}>
                      <td className="px-5 py-3 font-medium">{conversation.lead_name || "Unnamed lead"}</td>
                      <td className="px-3 py-3 text-mute">{formatRelativeTime(conversation.last_activity_at)}</td>
                      <td className="px-3 py-3">{CONVERSATION_STATUS_LABELS[conversation.status]}</td>
                      <td className="px-3 py-3 text-mute">{conversation.channel}</td>
                      <td className="px-3 py-3 text-mute">{ESCALATION_LABELS[conversation.escalation_reason ?? ""] ?? (conversation.status.startsWith("human") ? "Needs you" : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
