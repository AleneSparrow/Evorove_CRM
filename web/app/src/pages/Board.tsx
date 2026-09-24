import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Mail, Pause, Phone, Search, Trash2 } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { useAuth, describeError } from "../auth/AuthContext";
import {
  api,
  type BoardPerson,
  type BoardPersonDetail,
  type BoardTab,
  type LeadSearchStatus,
} from "../api/client";

const TABS: { id: BoardTab; label: string }[] = [
  { id: "cold", label: "Cold" },
  { id: "in_work", label: "In progress" },
  { id: "offer_sent", label: "Offer made" },
  { id: "done", label: "Done" },
];

const SEARCH_ACTIVE = new Set(["queued", "running"]);

function searchMessage(search: LeadSearchStatus | null): string {
  if (!search || search.status === "never_run") {
    return "Paste your website and we will look for people who need what you sell.";
  }
  if (search.status === "not_set_up") return "People search isn't connected yet.";
  if (SEARCH_ACTIVE.has(search.status)) return "Searching from your site… new people will appear on Cold.";
  if (search.status === "failed") return "The last search didn't finish. Try again.";
  const when = search.last_run_at ? new Date(search.last_run_at).toLocaleString("en-US") : "";
  if (search.cold > 0) return `Last search found ${search.cold} new ${search.cold === 1 ? "person" : "people"}${when ? ` · ${when}` : ""}.`;
  return `Last search found nobody new who fits${when ? ` · ${when}` : ""}. We search again every day.`;
}

function FindPeople({ onFound }: { onFound: () => void }) {
  const { token, businessId } = useAuth();
  const [search, setSearch] = useState<LeadSearchStatus | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token || !businessId) return;
    api
      .getLeadSearch(token, businessId)
      .then((res) => {
        setSearch(res);
        if (res.site_url) setSiteUrl((current) => current || res.site_url || "");
      })
      .catch(() => setSearch(null));
  }, [token, businessId]);

  useEffect(() => {
    if (!token || !businessId || !search || !SEARCH_ACTIVE.has(search.status)) return;
    const timer = window.setTimeout(() => {
      api
        .getLeadSearch(token, businessId)
        .then((res) => {
          setSearch(res);
          if (!SEARCH_ACTIVE.has(res.status)) onFound();
        })
        .catch((err) => setError(describeError(err)));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [token, businessId, search, onFound]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (!token || !businessId || !siteUrl.trim()) return;
    setSending(true);
    setError(null);
    try {
      setSearch(await api.startLeadSearch(token, businessId, siteUrl.trim()));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  const active = !!search && SEARCH_ACTIVE.has(search.status);
  const disabled = sending || active || search?.status === "not_set_up";
  return (
    <form onSubmit={start} className="mx-6 md:mx-8 mt-4 p-4 rounded-2xl border border-line bg-white flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          required
          value={siteUrl}
          onChange={(event) => setSiteUrl(event.target.value)}
          placeholder="https://your-business.com"
          aria-label="Your website"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-line text-sm"
        />
        <button
          type="submit"
          disabled={disabled}
          className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ backgroundColor: "#C6FF00", color: "#0B0B0D" }}
        >
          {active || sending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Find people
        </button>
      </div>
      <p className="text-xs text-mute">{error ?? searchMessage(search)}</p>
    </form>
  );
}

function personLabel(person: BoardPerson): string {
  return person.name || person.email || person.phone || "Person";
}

export default function Board() {
  const { token, businessId } = useAuth();
  const [tab, setTab] = useState<BoardTab>("cold");
  const [people, setPeople] = useState<BoardPerson[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoardPersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadPeople = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    setPeople(null);
    api
      .listBoard(token, businessId, tab)
      .then((res) => {
        if (cancelled) return;
        setPeople(res.people);
        setSelectedId((current) => {
          if (current && res.people.some((person) => person.person_id === current)) {
            return current;
          }
          return res.people[0]?.person_id ?? null;
        });
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId, tab, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId || !selectedId) {
      setDetail(null);
      return;
    }
    api
      .getBoardPerson(token, businessId, selectedId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId, selectedId]);

  async function runCommand(action: "discard" | "pause_outreach" | "takeover") {
    if (!token || !businessId || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await api.issueBoardCommand(token, businessId, selectedId, action);
      const listed = await api.listBoard(token, businessId, tab);
      setPeople(listed.people);
      if (!listed.people.some((person) => person.person_id === selectedId)) {
        setSelectedId(listed.people[0]?.person_id ?? null);
        setDetail(null);
      } else {
        setDetail(await api.getBoardPerson(token, businessId, selectedId));
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ev-page min-h-screen w-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">
        <header className="px-6 md:px-8 py-4 border-b border-line">
          <h1 className="text-xl font-semibold">People</h1>
          <p className="text-sm text-mute mt-0.5">
            Every touch from search and sale lands here. Tomorrow stays the booked hours.
          </p>
        </header>
        <div className="px-6 md:px-8 pt-4 flex gap-2 flex-wrap">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="px-3 py-1.5 rounded-full text-sm border transition-colors"
              style={{
                borderColor: tab === item.id ? "#0B0B0D" : "#E4DCCB",
                backgroundColor: tab === item.id ? "#C6FF00" : "#FFFCF6",
                fontWeight: tab === item.id ? 600 : 500,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "cold" && <FindPeople onFound={reloadPeople} />}
        {error && (
          <div className="mx-6 md:mx-8 mt-4 px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
            {error}
          </div>
        )}
        <div className="p-6 md:p-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="bg-white rounded-2xl border border-line overflow-hidden min-h-[320px]">
            {people === null ? (
              <div className="flex items-center justify-center gap-2 text-sm text-mute py-16">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : people.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-base font-medium">Nobody on this tab yet.</p>
                <p className="text-sm text-mute mt-2">
                  People appear after a real touch — found, written to, offered, booked, or paid.
                </p>
              </div>
            ) : (
              <ul>
                {people.map((person) => (
                  <li key={person.person_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(person.person_id)}
                      className="w-full text-left px-5 py-4 border-b border-[#F0EFE9] last:border-0 hover:bg-cream transition-colors"
                      style={{ backgroundColor: selectedId === person.person_id ? "#FFF8EC" : undefined }}
                    >
                      <div className="text-sm font-semibold truncate">{personLabel(person)}</div>
                      <div className="text-xs text-mute mt-1 truncate">{person.summary}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="bg-white rounded-2xl border border-line p-5 min-h-[320px]">
            {!detail ? (
              <p className="text-sm text-mute">Select a person to see every touch.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{personLabel(detail.person)}</h2>
                    <p className="text-sm text-mute mt-1">{detail.person.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-mute">
                      {detail.person.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone size={12} /> {detail.person.phone}
                        </span>
                      )}
                      {detail.person.email && (
                        <span className="flex items-center gap-1.5">
                          <Mail size={12} /> {detail.person.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runCommand("pause_outreach")}
                      className="p-2 rounded-lg border border-line text-mute hover:text-ink"
                      title="Pause outreach"
                    >
                      <Pause size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runCommand("discard")}
                      className="p-2 rounded-lg border border-line text-mute hover:text-ink"
                      title="Remove from the board"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <ol className="mt-6 flex flex-col gap-3">
                  {detail.touches.map((touch) => (
                    <li key={touch.touch_id} className="border-l-2 border-line pl-3">
                      <div className="text-xs uppercase tracking-wide text-clay">
                        Cycle {touch.cycle} · {touch.kind.replace(/_/g, " ")}
                      </div>
                      <div className="text-sm mt-0.5">{touch.summary}</div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
