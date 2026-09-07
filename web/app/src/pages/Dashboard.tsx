import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Loader2, Mail, Phone } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { useAuth, describeError } from "../auth/AuthContext";
import { api, type DashboardAppointment, type DashboardWaiting } from "../api/client";

function formatDay(isoDay: string, timeZone: string): string {
  const noon = `${isoDay}T12:00:00Z`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(noon));
}

function formatHour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { token, businessId } = useAuth();
  const [appointments, setAppointments] = useState<DashboardAppointment[] | null>(null);
  const [waiting, setWaiting] = useState<DashboardWaiting[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/Chicago");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token || !businessId) return;
    api
      .listAppointments(token, businessId)
      .then((res) => {
        if (cancelled) return;
        setAppointments(res.appointments);
        setWaiting(res.waiting ?? []);
        setDay(res.day);
        setTimezone(res.timezone);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, businessId]);

  return (
    <div className="ev-page min-h-screen w-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col pt-14 md:pt-0">
        <header className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-line">
          <div>
            <h1 className="text-xl font-semibold">Tomorrow</h1>
            <p className="text-sm text-mute mt-0.5">
              {day ? formatDay(day, timezone) : "The hours already on the calendar"}
            </p>
          </div>
        </header>

        <div className="p-6 md:p-8 flex flex-col gap-6">
          {error && (
            <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: "#FBEBE9", color: "#8A3225" }}>
              Couldn't load tomorrow's appointments: {error}
            </div>
          )}

          {appointments === null && !error ? (
            <div className="flex items-center gap-2 text-sm text-mute py-12 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading tomorrow…
            </div>
          ) : (
            <>
              {appointments && appointments.length === 0 ? (
                <div className="bg-white rounded-2xl border border-line px-6 py-12 text-center">
                  <p className="text-base font-medium">Tomorrow is still open.</p>
                  <p className="text-sm text-mute mt-2 max-w-md mx-auto">
                    People land here once the hour is set — already sold, already ready.
                    Not a list to chase.
                  </p>
                </div>
              ) : (
                <ul className="bg-white rounded-2xl border border-line overflow-hidden">
                  {(appointments ?? []).map((appointment) => (
                    <li
                      key={appointment.booking_id}
                      className="px-5 py-4 border-b border-[#F0EFE9] last:border-0 cursor-pointer hover:bg-cream transition-colors"
                      onClick={() => navigate(`/app/conversations?case=${appointment.case_id}`)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold truncate">
                              {appointment.lead.name || "Booked guest"}
                            </span>
                            <span className="text-[11px] text-clay uppercase tracking-wide">
                              {appointment.status.toLowerCase()}
                            </span>
                          </div>
                          <div className="text-sm text-mute truncate">
                            {appointment.service_name ?? appointment.service_id}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-mute">
                            {appointment.lead.phone && (
                              <span className="flex items-center gap-1.5">
                                <Phone size={12} /> {appointment.lead.phone}
                              </span>
                            )}
                            {appointment.lead.email && (
                              <span className="flex items-center gap-1.5">
                                <Mail size={12} /> {appointment.lead.email}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold flex items-center gap-1.5 justify-end">
                            <Clock size={14} />
                            {formatHour(appointment.start_at, appointment.timezone || timezone)}
                          </div>
                          <div className="text-[11px] text-clay mt-1">
                            {formatHour(appointment.end_at, appointment.timezone || timezone)}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {waiting.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold mb-1">Ready, no hour yet</h2>
                  <p className="text-sm text-mute mb-3">
                    They already agreed. The calendar hour is still open — not a list to chase.
                  </p>
                  <ul className="bg-white rounded-2xl border border-line overflow-hidden">
                    {waiting.map((row) => (
                      <li
                        key={row.case_id}
                        className="px-5 py-4 border-b border-[#F0EFE9] last:border-0 cursor-pointer hover:bg-cream transition-colors"
                        onClick={() => navigate(`/app/conversations?case=${row.case_id}`)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">
                              {row.lead.name || "Ready guest"}
                            </div>
                            <div className="text-sm text-mute truncate">
                              {row.service_name ?? row.service_id ?? "Service agreed"}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-mute">
                              {row.lead.phone && (
                                <span className="flex items-center gap-1.5">
                                  <Phone size={12} /> {row.lead.phone}
                                </span>
                              )}
                              {row.lead.email && (
                                <span className="flex items-center gap-1.5">
                                  <Mail size={12} /> {row.lead.email}
                                </span>
                              )}
                            </div>
                          </div>
                          {row.waiting_channel && (
                            <span className="shrink-0 text-[11px] text-clay uppercase tracking-wide">
                              {row.waiting_channel.replace("_", " ")}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
