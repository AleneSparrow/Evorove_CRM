import { useNavigate } from "react-router-dom";
import {
  ArrowRight, ShieldCheck, Check, MessageSquare, Scale,
  CalendarCheck, UserCheck, FileWarning, Clock,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { MarketingFooter, MarketingHeader } from "../brand/MarketingChrome";

/**
 * Wave 1 GTM landing page -- solo & small family-law / general-practice
 * attorneys, California & New York first (docs/marketing/04-gtm-legal-vertical.md,
 * docs/marketing/05-wave1-outreach-materials.md). Separate route from the
 * general Landing.tsx so outreach links (LinkedIn, cold email, Clio
 * marketplace) can point somewhere written for this exact audience without
 * touching the product's general-purpose homepage.
 *
 * Deliberate scope limits carried over from the GTM doc, not decoration:
 * - Starter ($199/mo) only. Pro is never mentioned as a "for your team" tier
 *   here -- multi-attorney routing isn't built yet (P1), and the GTM doc is
 *   explicit that selling Pro to a solo practice today creates disappointed
 *   early customers, not revenue.
 * - Compliance/architecture is the lead argument, not price. SetSmart is
 *   cheaper ($99) and not deterministic; that contrast is the whole pitch.
 * - The FAQ answers honestly that bar rules vary by state and this isn't
 *   legal advice about compliance -- matches the brand voice's "no
 *   superlatives" rule and avoids overclaiming into UPL-adjacent territory
 *   ourselves.
 */

function StatChip({ n, label }: { n: string; label: string }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="ev-display text-3xl mb-1" style={{ color: "#FF5A36" }}>
        {n}
      </div>
      <div className="text-xs text-mute leading-snug">{label}</div>
    </div>
  );
}

function DoesItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink">
      <Check size={16} className="mt-0.5 shrink-0" color="#1E7B52" /> {text}
    </li>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="py-5 border-b border-line last:border-0">
      <div className="text-sm font-semibold mb-1.5">{q}</div>
      <div className="text-sm text-mute leading-relaxed">{a}</div>
    </div>
  );
}

export default function LawyersLanding() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const primaryCtaTarget = user ? (user.business_ids.length > 0 ? "/app" : "/onboarding") : "/signup";

  return (
    <div className="ev-page min-h-screen w-full">
      <MarketingHeader
        homeTo="/lawyers"
        ctaLabel="Start free trial"
        links={[
          { href: "#different", label: "How it's different" },
          { href: "#pricing", label: "Pricing" },
          { href: "#faq", label: "FAQ" },
        ]}
      />

      {/* ============ HERO ============ */}
      <section className="max-w-4xl mx-auto px-6 pt-16 md:pt-24 pb-14 text-center">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full mb-6" style={{ backgroundColor: "#FFE8E1", color: "#FF5A36" }}>
          <Scale size={12} /> Built for solo & small practices — California &amp; New York
        </div>
        <h1 className="ev-display text-6xl md:text-7xl leading-[0.9] mb-5">
          The AI intake assistant that legally can't overstep.
        </h1>
        <p className="text-base md:text-lg text-mute leading-relaxed mb-8 max-w-2xl mx-auto">
          Evorove answers and qualifies every lead for your practice, 24/7 — built so the AI can only
          follow the script you approve. Not a policy. An architecture.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => navigate(primaryCtaTarget)}
            className="text-sm font-bold uppercase tracking-wide px-5 py-3 rounded-full flex items-center gap-2"
            style={{ backgroundColor: "#C6FF00", color: "#0B0B0D" }}
        >
            Start your 7-day free trial <ArrowRight size={15} />
          </button>
          <a href="#different" className="text-sm font-medium px-5 py-3 rounded-full border border-ink">
            See how it works
          </a>
        </div>
        <span className="block text-xs text-clay mt-4">$199/mo after trial · card required, no charge until trial ends</span>
      </section>

      <section className="border-y border-line bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-center gap-3 text-sm text-clay text-center">
          <ShieldCheck size={15} className="shrink-0" /> Discloses itself as AI, every time — built for the standard California (SB 243) and New York (Article 47) already require.
        </div>
      </section>

      {/* ============ THE PROBLEM ============ */}
      <section className="max-w-4xl mx-auto px-6 py-16 md:py-20">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#FF5A36" }}>The problem</span>
        <h2 className="ev-display text-4xl md:text-5xl mt-2 mb-5">
          Every missed call is a lead you already paid for.
        </h2>
        <p className="text-base text-mute leading-relaxed max-w-2xl mb-8">
          The average cost per lead in legal services runs close to $649 — and most callers who hit
          voicemail never call back. A full-time intake specialist costs $55,000–$80,000 a year fully
          loaded, and even a great one can't answer at 11pm on a Sunday.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatChip n="$649" label="Avg. cost per lead, legal services" />
          <StatChip n="37.8%" label="Of inbound calls answered by a live person, industry-wide" />
          <StatChip n="85%" label="Of callers who hit voicemail never call back" />
          <StatChip n="$55–80K" label="Fully-loaded intake specialist, per year" />
        </div>
      </section>

      {/* ============ HOW IT'S DIFFERENT ============ */}
      <section id="different" className="bg-white border-y border-line">
        <div className="max-w-4xl mx-auto px-6 py-16 md:py-20">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#FF5A36" }}>How Evorove is different</span>
          <h2 className="ev-display text-4xl md:text-5xl mt-2 mb-6">
            An architecture, not a prompt.
          </h2>
          <p className="text-base text-mute leading-relaxed mb-6 max-w-2xl">
            Most AI intake tools are a chatbot wrapped around a general-purpose language model, steered
            by a prompt. Prompts can be argued with, jailbroken, or simply drift over a long conversation
            — and for a law firm, that's not a UX risk, it's a bar-complaint risk.
          </p>
          <p className="text-base text-mute leading-relaxed mb-8 max-w-2xl">
            Evorove works differently. The AI never decides what to tell your client — it only rewrites
            the wording of a script you control (your "Business DNA"). Case qualification, escalation
            rules, and what the assistant is and isn't allowed to say all live in the underlying engine,
            not in a prompt the AI could talk itself out of.
          </p>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <div className="rounded-xl border border-line bg-cream p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-mute mb-4">A chatbot on a prompt</div>
              <ul className="flex flex-col gap-3 text-sm text-mute">
                <li className="pt-3 border-t border-line first:pt-0 first:border-0">The AI decides what to say, guided by instructions</li>
                <li className="pt-3 border-t border-line">Can be talked into estimating a case or promising an outcome</li>
                <li className="pt-3 border-t border-line">Compliance depends on the prompt holding up under pressure</li>
                <li className="pt-3 border-t border-line">Disclosure is whatever the prompt remembers to say</li>
              </ul>
            </div>
            <div className="rounded-xl p-6" style={{ backgroundColor: "#0B0B0D" }}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#C6FF00" }}>Evorove</div>
              <ul className="flex flex-col gap-3 text-sm" style={{ color: "#E7E2D5" }}>
                <li className="pt-3 border-t first:pt-0 first:border-0" style={{ borderColor: "#33302B" }}>The AI only rewrites the wording of a script you approve</li>
                <li className="pt-3 border-t" style={{ borderColor: "#33302B" }}>Has no path to invent legal analysis or promise a result</li>
                <li className="pt-3 border-t" style={{ borderColor: "#33302B" }}>Compliance is a hard limit in the message pipeline, not a prompt</li>
                <li className="pt-3 border-t" style={{ borderColor: "#33302B" }}>Identifies itself as AI from the first message, every time</li>
              </ul>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-line p-5">
              <FileWarning size={18} color="#FF5A36" className="mb-3" />
              <div className="text-sm font-semibold mb-1">Can't estimate outcomes</div>
              <div className="text-xs text-mute leading-relaxed">No path in the message pipeline to invent legal analysis or promise a result.</div>
            </div>
            <div className="rounded-xl border border-line p-5">
              <UserCheck size={18} color="#FF5A36" className="mb-3" />
              <div className="text-sm font-semibold mb-1">Always identifies as AI</div>
              <div className="text-xs text-mute leading-relaxed">A visible disclosure badge stays on screen for the whole conversation, not buried in a footer.</div>
            </div>
            <div className="rounded-xl border border-line p-5">
              <Clock size={18} color="#FF5A36" className="mb-3" />
              <div className="text-sm font-semibold mb-1">Same guarantee, every plan</div>
              <div className="text-xs text-mute leading-relaxed">The compliance architecture isn't a premium feature — it's how every message gets built, always.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ WHAT IT DOES ============ */}
      <section className="max-w-4xl mx-auto px-6 py-16 md:py-20">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#FF5A36" }}>What it does</span>
        <h2 className="ev-display text-4xl md:text-5xl mt-2 mb-7">
          One script, applied the same way every time.
        </h2>
        <ul className="flex flex-col gap-3.5 max-w-lg">
          <DoesItem text="Answers inbound leads on your website, day or night" />
          <DoesItem text="Qualifies the case against the criteria you set — practice area, urgency, location" />
          <DoesItem text="Books a consultation on Evorove's calendar so you can take the meeting prepared" />
          <DoesItem text="Escalates to you exactly when your rules say to" />
          <DoesItem text="Never estimates case outcomes, gives legal advice, or promises a result — by design, not by request" />
        </ul>
      </section>

      {/* ============ BUILT FOR SOLO PRACTICES ============ */}
      <section className="bg-white border-y border-line">
        <div className="max-w-4xl mx-auto px-6 py-14 md:py-16 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
          <div>
            <h2 className="ev-display text-3xl mb-2">Built for solo practices</h2>
            <p className="text-sm text-mute leading-relaxed max-w-lg">
              Evorove Starter is built for exactly one attorney, one jurisdiction — set up in about
              20 minutes, no developer or IT help needed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium shrink-0 px-4 py-2.5 rounded-lg" style={{ backgroundColor: "#FFE8E1", color: "#FF5A36" }}>
            <CalendarCheck size={16} /> ~20 minutes to go live
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section id="pricing" className="max-w-2xl mx-auto px-6 py-16 md:py-20 text-center">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#FF5A36" }}>Pricing</span>
        <h2 className="ev-display text-4xl md:text-5xl mt-2 mb-8">
          One plan, built for one attorney.
        </h2>
        <div className="bg-white rounded-2xl border border-line p-8 md:p-10 text-left">
          <div className="flex items-baseline justify-between mb-1">
            <span className="ev-wordmark text-[22px] tracking-[0.06em]">Starter</span>
            <span className="ev-display text-5xl">$199<span className="text-sm text-mute font-normal">/mo</span></span>
          </div>
          <p className="text-sm text-mute mb-6">7-day free trial. Card required at signup, no charge until the trial ends. Cancel anytime.</p>
          <ul className="flex flex-col gap-2.5 mb-7">
            <DoesItem text="One attorney, one jurisdiction — full deterministic compliance architecture" />
            <DoesItem text="24/7 web chat intake, qualification, and booking" />
            <DoesItem text="Complete audit trail on every conversation" />
            <DoesItem text="AI disclosure badge and compliance disclaimer, built in" />
          </ul>
          <button
            onClick={() => navigate(primaryCtaTarget)}
            className="w-full text-sm font-bold uppercase tracking-wide px-5 py-3 rounded-full flex items-center justify-center gap-2"
            style={{ backgroundColor: "#C6FF00", color: "#0B0B0D" }}
        >
            Start your 7-day free trial <ArrowRight size={15} />
          </button>
        </div>
        <p className="text-xs text-clay mt-5">
          Multi-attorney support is on our roadmap — reach out and we'll let you know when it's ready for your firm.
        </p>
      </section>

      {/* ============ FAQ ============ */}
      <section id="faq" className="bg-white border-t border-line">
        <div className="max-w-2xl mx-auto px-6 py-16 md:py-20">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#FF5A36" }}>FAQ</span>
          <h2 className="ev-display text-4xl md:text-5xl mt-2 mb-6">Questions attorneys ask first</h2>
          <div>
            <FaqItem
              q="Is this actually compliant with my state's bar rules?"
              a={`Evorove is built to support the disclosure requirements already in effect in states like California (SB 243) and New York (Article 47) — the AI identifies itself clearly, includes a "not legal advice" notice, and always offers a path to a human. That said, bar rules vary by state, and we'd always recommend a quick read of your own state's guidance before launch — we're not your compliance counsel.`}
            />
            <FaqItem
              q="Can the AI give legal advice by accident?"
              a="No — and that's the point. The AI only rewrites wording inside the script you approve. It has no path to invent legal analysis, estimate outcomes, or promise results, because that capability isn't built into the message pipeline at all."
            />
            <FaqItem q="How long does setup take?" a="About 20 minutes for a single-attorney practice. No developer needed." />
            <FaqItem
              q="What if I want more than one attorney on the account?"
              a="Multi-attorney support is on our roadmap — reach out and we'll let you know when it's ready for your firm."
            />
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="max-w-4xl mx-auto px-6 py-20 md:py-28 text-center">
        <MessageSquare size={28} color="#FF5A36" className="mx-auto mb-5" />
        <h2 className="ev-display text-5xl md:text-6xl mb-4">
          Someone is calling your firm right now.
        </h2>
        <p className="text-mute mb-8 max-w-md mx-auto">7-day free trial, live in about 20 minutes, no setup call required.</p>
        <button
          onClick={() => navigate(primaryCtaTarget)}
          className="text-sm font-bold uppercase tracking-wide px-6 py-3.5 rounded-full inline-flex items-center gap-2"
          style={{ backgroundColor: "#C6FF00", color: "#0B0B0D" }}
      >
          Start your 7-day free trial <ArrowRight size={15} />
        </button>
      </section>

      <MarketingFooter extra={<span>Deterministic by design</span>} />
    </div>
  );
}
