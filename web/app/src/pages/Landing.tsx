import { Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { FaqSection } from "../components/FaqSection";
import { MarketingFooter, MarketingHeader } from "../brand/MarketingChrome";
import { brand } from "../brand/theme";

const OrbitScene = lazy(() => import("../brand/OrbitScene").then((mod) => ({ default: mod.OrbitScene })));

function Block({ n, title, body, tone }: { n: string; title: string; body: string; tone: "ink" | "coral" | "lime" }) {
  const bg = tone === "ink" ? brand.ink : tone === "coral" ? brand.coral : brand.lime;
  const fg = tone === "lime" ? brand.ink : brand.cream;
  return (
    <div className="p-6 min-h-[160px] flex flex-col justify-between" style={{ background: bg, color: fg }}>
      <div className="ev-display text-4xl">{n} {title}</div>
      <p className="text-sm leading-relaxed mt-6 max-w-xs">{body}</p>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const primaryCtaTarget = user ? (user.business_ids.length > 0 ? "/app" : "/onboarding") : "/signup";

  return (
    <div className="ev-page min-h-screen w-full overflow-x-hidden">
      <MarketingHeader />

      <section className="relative min-h-[92vh] max-w-6xl mx-auto px-6 pt-10 md:pt-16 pb-10">
        <div className="absolute inset-y-0 right-[-8%] w-[58%] pointer-events-none hidden md:block">
          <Suspense fallback={null}>
            <OrbitScene variant="hero" />
          </Suspense>
        </div>
        <div className="relative z-10 max-w-xl">
          <div className="inline-block mb-5 text-[11px] font-extrabold uppercase tracking-[0.16em] px-3 py-1.5 -rotate-2" style={{ background: "#C6FF00", color: "#0B0B0D" }}>
            Cycle 3 · the hour
          </div>
          <h1 className="ev-display text-[88px] md:text-[128px] text-ink">
            TOMORROW<br />IS BOOKED.
          </h1>
          <p className="text-base md:text-lg text-mute leading-relaxed mt-6 mb-8 max-w-md">
            People arrive already ready. This CRM collects what the service needs and puts a real hour on the calendar.
            Finding them and selling until they are ready lives elsewhere — not here.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-12">
            <button
              onClick={() => navigate(primaryCtaTarget)}
              className="text-[12px] font-bold uppercase tracking-[0.14em] px-5 py-3 rounded-full inline-flex items-center gap-2"
              style={{ background: "#C6FF00", color: "#0B0B0D" }}
            >
              Open tomorrow <ArrowRight size={15} />
            </button>
            <a href="#how" className="text-[12px] font-bold uppercase tracking-[0.14em] px-5 py-3 rounded-full" style={{ background: "#0B0B0D", color: "#F7F1E4" }}>
              See the desk
            </a>
          </div>
          <div className="flex gap-10">
            <div>
              <div className="ev-display text-5xl">1hr</div>
              <div className="text-xs uppercase tracking-[0.16em] text-clay">A real calendar hour</div>
            </div>
            <div>
              <div className="ev-display text-5xl">100%</div>
              <div className="text-xs uppercase tracking-[0.16em] text-clay">Steps audited</div>
            </div>
            <div>
              <div className="ev-display text-5xl">0</div>
              <div className="text-xs uppercase tracking-[0.16em] text-clay">Silent AI slots</div>
            </div>
          </div>
        </div>
        <div className="md:hidden h-[280px] -mx-6 mt-8">
          <Suspense fallback={null}>
            <OrbitScene variant="hero" />
          </Suspense>
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 pb-6">
        <div className="grid md:grid-cols-3 gap-2.5">
          <Block n="01" title="RECEIVE" tone="ink" body="A hot lead from the sale — agreed service, ready to book, not yet on the calendar." />
          <Block n="02" title="COLLECT" tone="coral" body="Zone, forms, and the facts the service actually needs. Not a second sales pitch." />
          <Block n="03" title="BOOK" tone="lime" body="A specific hour through ProcessEngine. Tomorrow’s list is who is coming — not who to chase." />
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-coral mb-3">Desk</p>
        <h2 className="ev-display text-6xl md:text-7xl mb-10">The evening screen.<br />Not a funnel to close.</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            ["Already sold", "Sale finished before this desk. CRM does not start a cold pitch."],
            ["Your rules", "Business DNA encodes services, zone, hours, and what must be collected."],
            ["No guessing", "The hour is set only through the existing booking engine — never a silent AI slot."],
          ].map(([title, body]) => (
            <div key={title} className="p-6 border" style={{ borderColor: "#E4DCCB", background: "#FFFCF6" }}>
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm text-mute leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="trust" className="border-y" style={{ borderColor: "#E4DCCB", background: "#0B0B0D", color: "#F7F1E4" }}>
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] mb-3" style={{ color: "#C6FF00" }}>Audit</p>
            <h2 className="ev-display text-6xl mb-6">Nothing the engine does is invisible.</h2>
            <ul className="flex flex-col gap-3.5">
              {[
                "Every trigger, decision, and action is written to an append-only history",
                "AI drafts wording — it never bypasses your workflow or risk rules",
                "Trace any booking, quote, or reply back to the exact step",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm">
                  <Check size={16} className="mt-0.5 shrink-0" color="#C6FF00" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-5" style={{ background: "#161616", border: "1px solid #2A2A2A" }}>
            <div className="text-xs mb-3" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#9A8F83" }}>CS-1042 · audit trail</div>
            <div className="flex flex-col gap-2.5 text-sm">
              {[
                ["09:41:02", "Receive", "Hot lead accepted from Evorove"],
                ["09:41:03", "Collect", "Zone and required service fields"],
                ["09:41:04", "Decision", "Bookable path from Business DNA"],
                ["09:41:08", "Action", "Hour confirmed through ProcessEngine"],
                ["09:41:08", "Result", "On tomorrow’s list"],
              ].map(([time, stage, desc]) => (
                <div key={stage} className="flex gap-3">
                  <span className="shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#9A8F83" }}>{time}</span>
                  <span className="font-medium shrink-0 w-16" style={{ color: "#C6FF00" }}>{stage}</span>
                  <span className="text-[#C9C2B6]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <FaqSection />

      <section className="max-w-6xl mx-auto px-6 py-20 md:py-28 text-center">
        <h2 className="ev-display text-6xl md:text-7xl mb-5">Tomorrow should already<br />have names on it.</h2>
        <p className="text-mute mb-8 max-w-md mx-auto">Open the desk. See the hours. Accept the people who are ready.</p>
        <button
          onClick={() => navigate(primaryCtaTarget)}
          className="text-[12px] font-bold uppercase tracking-[0.14em] px-6 py-3.5 rounded-full inline-flex items-center gap-2"
          style={{ background: "#FF5A36", color: "#0B0B0D" }}
      >
          Set up your business <ArrowRight size={15} />
        </button>
      </section>

      <div className="max-w-6xl mx-auto px-6 pb-8 flex items-center justify-center gap-2 text-sm text-clay">
        <ShieldCheck size={15} /> Deterministic, reviewable, reversible — never a black box.
      </div>

      <MarketingFooter />
    </div>
  );
}
