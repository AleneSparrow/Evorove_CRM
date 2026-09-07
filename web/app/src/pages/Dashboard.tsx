import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Bell, ArrowUpRight, Clock, Phone, Mail, Loader2, ArrowDown, ArrowUp } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { useAuth, describeError } from "../auth/AuthContext";
import { api, type DashboardCaseSummary } from "../api/client";
import { ESCALATION_ACTIONS, ESCALATION_LABELS, ESCALATION_OUTCOMES } from "../lib/escalationCopy";
import {
  STATE_META,
  Stepper,
  StatePill,
  mapProcessState,
  describeEvent,
  formatRelativeTime,
  type CaseState,
} from "../components/Shared";

const FILTERS: (CaseState | "ALL")[] = ["ALL", "NEEDS_HUMAN", "QUALIFYING", "BOOKED", "LOST", "COMPLETED"];

type SortKey = "date" | "name";
type SortDirection = "asc" | "desc";

function nextStep(state: CaseState): string {
  if (state === "NEEDS_HUMAN") return "Review the conversation and reply";
  if (state === "QUALIFYING") return "Collect the remaining qualification details";
  if (state === "BOOKED") return "Prepare for the appointment";
  if (state === "LOST") return "Review whether reactivation is appropriate";
  if (state === "COMPLETED") return "Request a review or referral";
  return "Open the conversation to review the next action";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { token, businessId } = useAuth();
  const [cases, setCases] = useState<DashboardCaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CaseState | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    api
      .listCases(token, businessId, { ignoreBaseline: true })
      .then((res) => {
        if (cancelled) return;
        setCases(res.cases);
        setSelectedId((prev) => prev ?? res.cases[0]?.case_id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId]);

  const decorated = useMemo(
    () =>
      (cases ?? []).map((c) => {
        const { caseState, stage } = mapProcessState(c.current_state);
        const detail = c.latest_event_type ? describeEvent(c.latest_event_type).label : "No activity yet";
        const followUpDue = ["QUALIFYING", "FOLLOW_UP"].includes(c.current_state)
          && Date.now() - new Date(c.updated_at).getTime() > 24 * 60 * 60 * 1000;
        return { ...c, caseState, stage, detail, followUpDue };
      }),
    [cases],
  );

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const visible = (filter === "ALL" ? [...decorated] : decorated.filter((c) => c.caseState === filter)).filter((c) => {
      if (!query) return true;
      return [c.lead.name, c.lead.phone, c.lead.email, c.category, c.case_id, c.lead.lead_id]
        .some((value) => value?.toLowerCase().includes(query));
    });
    return visible.sort((left, right) => {
      if (sortBy === "date") {
        const comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        return sortDirection === "asc" ? comparison : -comparison;
      }
      const leftValue = left.lead.name;
      const rightValue = right.lead.name;
      if (!leftValue && !rightValue) return 0;
      if (!leftValue) return 1;
      if (!rightValue) return -1;
      const comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [decorated, filter, searchQuery, sortBy, sortDirection]);

  const changeSort = (nextSort: SortKey) => {
    setSortBy(nextSort);
    setSortDirection(nextSort === "date" ? "desc" : "asc");
  };


  const selected = useMemo(
    () => decorated.find((c) => c.case_id === selectedId) ?? decorated[0] ?? null,
    [decorated, selectedId],
  );

  const counts = useMemo(() => {
    const c = { needsHuman: 0, booked: 0, qualifying: 0, lost: 0, completed: 0 };
    decorated.forEach((x) => {
      if (x.caseState === "NEEDS_HUMAN") c.needsHuman++;
      if (x.caseState === "BOOKED") c.booked++;
      if (x.caseState === "QUALIFYING") c.qualifying++;
      if (x.caseState === "LOST") c.lost++;
      if (x.caseState === "COMPLETED") c.completed++;
    });
    return c;
  }, [decorated]);

  const sortDirectionLabel = sortBy === "date"
    ? sortDirection === "desc" ? "Newest first" : "Oldest first"
    : sortDirection === "asc" ? "A to Z" : "Z to A";

  const openAttentionQueue = () => {
    navigate("/app/conversations?attention=1");
  };

  const filterCount = (state: CaseState | "ALL") => {
    if (state === "ALL") return decorated.length;
    if (state === "NEEDS_HUMAN") return counts.needsHuman;
    if (state === "QUALIFYING") return counts.qualifying;
    if (state === "BOOKED") return counts.booked;
    if (state === "LOST") return counts.lost;
    return counts.completed;
  };

  useEffect(() => {
    setActionError(null);
  }, [selectedId]);

  // The case list (DashboardCaseSummary) has no conversation_id of its own --
  // look the conversation up by case_id first, then approve its pending
  // transition via the same StaffActionService.resolve the Conversations
  // page already uses (see Conversation.tsx's handleResolve). Patches the
  // resolved case in place from the response rather than a full re-fetch.
  const handleResolve = async () => {
    if (!token || !businessId || !selected) return;
    setResolvingId(selected.case_id);
    setActionError(null);
    try {
      const { conversations } = await api.listConversations(token, businessId);
      const match = conversations.find((c) => c.case_id === selected.case_id);
      if (!match) {
        setActionError("Couldn't find the conversation for this case.");
        return;
      }
      const result = await api.resolveConversation(token, businessId, match.conversation_id);
      if (result.case) {
        const resolvedCase = result.case;
        setCases((prev) => (prev ?? []).map((c) => (c.case_id === resolvedCase.case_id ? resolvedCase : c)));
      }
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="ev-page min-h-screen w-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">
        <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-line">
          <div>
            <h1 className="text-xl font-semibold">Leads & cases</h1>
            <p className="text-sm text-mute mt-0.5">Every conversation your engine has handled</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-clay" />
              <input
                aria-label="Search leads"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9 pr-3 py-2 rounded-lg bg-white border border-line text-sm w-52 outline-none focus:ring-2 focus:ring-coral/20"
              />
            </div>
            <button
              type="button"
              onClick={openAttentionQueue}
              aria-label={`Open the ${counts.needsHuman} conversations that need you`}
              title={`Open the ${counts.needsHuman} conversations that need you`}
              className="relative w-9 h-9 rounded-lg border border-line bg-white flex items-center justify-center transition-colors hover:border-coral"
          >
              <Bell size={16} strokeWidth={2} />
              {counts.needsHuman > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] flex items-center justify-center font-bold" style={{ backgroundColor: "#C6FF00", color: "#0B0B0D" }}>{counts.needsHuman}</span>
              )}
            </button>
          </div>
        </header>

        <div className="p-6 md:p-8 flex flex-col gap-6">
          {error && (
            <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
              Couldn't load your leads: {error}
            </div>
          )}

          {cases === null && !error ? (
            <div className="flex items-center gap-2 text-sm text-mute py-12 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading your leads…
            </div>
          ) : decorated.length === 0 ? (
            <div className="bg-white rounded-2xl border border-line px-6 py-12 text-center text-sm text-mute">
              No leads yet. Once a customer messages your widget or number, cases will show up here in real time.
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0 bg-white rounded-2xl border border-line overflow-hidden">
                {/* flex-wrap, not overflow-x-auto. The chips used to sit on
                    one scrolling line with the sort control pinned beside
                    them, so at 1440px "Completed" was cut in half and at
                    laptop widths "Booked" was too -- a filter you cannot see
                    is a filter that does not exist. They now wrap onto as
                    many rows as they need and every chip stays whole. The
                    sort control is gone: the list orders itself by urgency
                    (see `filtered`), which is the only order a work queue
                    wants. */}
                <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
                  {FILTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilter(s)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors"
                      style={{ backgroundColor: filter === s ? "#FFE8E1" : "transparent", color: filter === s ? "#FF5A36" : "#6B6459" }}
                  >
                      {s === "ALL" ? `All (${filterCount(s)})` : `${STATE_META[s].label} (${filterCount(s)})`}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1.5 shrink-0 text-xs text-mute">
                    <label>
                    <span className="sr-only">Sort leads</span>
                    <select
                      aria-label="Sort leads"
                      value={sortBy}
                      onChange={(event) => changeSort(event.target.value as SortKey)}
                      className="bg-white border border-line rounded-lg px-2.5 py-1.5 outline-none"
                  >
                      <option value="date">Date added</option>
                      <option value="name">Name</option>
                    </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
                      aria-label={`Sort direction: ${sortDirectionLabel}. Click to reverse.`}
                      title={`${sortDirectionLabel} — click to reverse`}
                      className="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center hover:border-coral transition-colors"
                  >
                      {sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                    </button>
                    <span className="hidden xl:inline min-w-[68px]">{sortDirectionLabel}</span>
                  </div>
                </div>
                {filter !== "ALL" && (
                  <div className="px-5 py-2 text-xs text-mute bg-coral-wash border-b border-line flex items-center justify-between gap-3">
                    <span>Showing {filtered.length} filtered leads.</span>
                    <button type="button" onClick={() => setFilter("ALL")} className="font-medium text-ink underline">Clear filter</button>
                  </div>
                )}
                <ul>
                  {filtered.length === 0 && (
                    <li className="px-5 py-10 text-center text-sm text-mute">No leads match your search and filters.</li>
                  )}
                  {filtered.map((c) => (
                    <li
                      key={c.case_id}
                      onClick={() => navigate(`/app/conversations?case=${c.case_id}`)}
                      className="px-5 py-4 border-b border-[#F0EFE9] last:border-0 cursor-pointer transition-colors"
                      style={{ backgroundColor: selected?.case_id === c.case_id ? "#FFE8E1" : "transparent" }}
                  >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold truncate">{c.lead.name || "Unnamed lead"}</span>
                            <span className="text-[11px] text-clay" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{c.case_id.slice(0, 8)}</span>
                          </div>
                          <div className="text-sm text-mute truncate">{c.category ?? "Uncategorized"} · {c.detail}</div>
                          {c.followUpDue && <div className="mt-1 text-[11px] font-medium text-coral-deep">Follow-up overdue</div>}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <StatePill state={c.caseState} />
                          <span className="text-[11px] text-clay flex items-center gap-1"><Clock size={11} /> {formatRelativeTime(c.updated_at)}</span>
                        </div>
                      </div>
                      <div className="mt-3"><Stepper stage={c.stage} color={STATE_META[c.caseState].color} /></div>
                    </li>
                  ))}
                </ul>
              </div>

              {selected && (
                <div className="w-full lg:w-80 shrink-0 bg-white rounded-2xl border border-line p-5 h-fit sticky top-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] uppercase tracking-wide text-clay font-medium" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{selected.case_id.slice(0, 8)}</span>
                    <StatePill state={selected.caseState} />
                  </div>
                  <h2 className="text-lg font-semibold mb-1">{selected.lead.name || "Unnamed lead"}</h2>
                  <p className="text-sm text-mute mb-4">{selected.event_count} event{selected.event_count === 1 ? "" : "s"} recorded</p>
                  <div className="mb-5">
                    <div className="text-xs font-medium text-clay mb-2">Where this case is</div>
                    <Stepper stage={selected.stage} color={STATE_META[selected.caseState].color} labels />
                  </div>
                  <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: "#FAFAF7" }}>
                    <p className="text-sm leading-relaxed">{selected.detail}</p>
                  </div>
                  {selected.escalation_reason && (
                    <div className="rounded-xl border border-[#E8CFAF] bg-[#FFF8EE] p-3 mb-4">
                      <div className="text-xs font-medium text-[#8A561B] mb-1">Why it needs attention</div>
                      <p className="text-sm text-mute">
                        {ESCALATION_LABELS[selected.escalation_reason] ?? "Human review requested"}
                      </p>
                      <p className="text-sm text-mute mt-1.5">
                        Next safe action: {ESCALATION_ACTIONS[selected.escalation_reason] ?? "Open the lead and choose the next safe step."}
                      </p>
                      {ESCALATION_OUTCOMES[selected.escalation_reason] && (
                        <p className="text-xs text-mute mt-1.5">{ESCALATION_OUTCOMES[selected.escalation_reason]}</p>
                      )}
                    </div>
                  )}
                  <div className="mb-5">
                    <div className="text-xs font-medium text-clay mb-1">Recommended next step</div>
                    <p className="text-sm">{nextStep(selected.caseState)}</p>
                  </div>
                  {actionError && (
                    <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
                      {actionError}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <button onClick={() => navigate(`/app/conversations?case=${selected.case_id}`)} className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2" style={{ backgroundColor: "#0B0B0D" }}>
                      Open conversation <ArrowUpRight size={14} />
                    </button>
                    {selected.caseState === "NEEDS_HUMAN" && (
                      <button
                        onClick={handleResolve}
                        disabled={resolvingId === selected.case_id}
                        className="w-full py-2.5 rounded-lg text-sm font-medium border border-line flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                        {resolvingId === selected.case_id && <Loader2 size={14} className="animate-spin" />}
                        Mark resolved
                      </button>
                    )}
                  </div>
                  <div className="mt-5 pt-4 border-t border-[#F0EFE9] flex items-center gap-4 text-xs text-mute">
                    <span className="flex items-center gap-1.5"><Phone size={12} /> {selected.lead.phone || "Not on file"}</span>
                    <span className="flex items-center gap-1.5"><Mail size={12} /> {selected.lead.email || "Not on file"}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
