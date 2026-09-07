import { useMemo, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowLeft, Check, Plus, X, Building2, Wrench, MapPin, Globe,
  MessageCircleQuestion, ShieldAlert, Sparkles,
} from "lucide-react";
import { useAuth, describeError } from "../auth/AuthContext";
import { api, type OnboardingServicePayload } from "../api/client";
import { AreaOption, Field, EvoroveMark, inputCls, ToneOption } from "../components/Shared";

/**
 * Adaptive to any business, not just a fixed vertical -- see
 * src/domain/business_dna_builder.py for how each answer here maps onto the
 * real Business DNA. Nothing in this wizard assumes a home-services /
 * appointment-based business: "Who can you serve?" supports a fully remote
 * business with no fixed area (maps to a `remote` service area, not
 * `postal_codes`), and industry is free text, not a fixed list.
 */

const OB_STEPS: { key: string; label: string; icon: ComponentType<{ size?: number | string }> }[] = [
  { key: "basics", label: "Business", icon: Building2 },
  { key: "services", label: "Services", icon: Wrench },
  { key: "area", label: "Who you serve", icon: MapPin },
  { key: "questions", label: "Questions", icon: MessageCircleQuestion },
  { key: "escalation", label: "Escalation", icon: ShieldAlert },
  { key: "review", label: "Review", icon: Sparkles },
];

function ProgressRail({ current }: { current: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {OB_STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = s.icon;
        return (
          <div key={s.key} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors"
                style={{ backgroundColor: done ? "#1E7B52" : active ? "#0B0B0D" : "#F1F1EF", color: done || active ? "#fff" : "#9A8F83" }}
            >
                {done ? <Check size={14} /> : <Icon size={14} />}
              </div>
              {i < OB_STEPS.length - 1 && (
                <div className="w-px flex-1 min-h-[22px]" style={{ backgroundColor: done ? "#1E7B52" : "#E4DCCB" }} />
              )}
            </div>
            <div className="pt-1.5 pb-4">
              <div className="text-sm" style={{ color: active || done ? "#0B0B0D" : "#9A8F83", fontWeight: active ? 600 : 500 }}>
                {s.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TONE_OPTIONS: [string, string][] = [
  ["Friendly & direct", "Warm, no filler"],
  ["Formal & precise", "Professional tone"],
  ["Casual & brief", "Short, plain texts"],
];

/** Free-text industry with suggestions -- not a fixed list. The business isn't
 * limited to any one of these; a <datalist> just speeds up typing. */
const INDUSTRY_SUGGESTIONS = [
  "Consulting", "Coaching", "Real estate", "Legal services", "Health & wellness",
  "Education & tutoring", "Marketing agency", "E-commerce", "SaaS / Software",
  "Financial services", "Events & photography", "Home services", "Auto repair",
  "Restaurant & hospitality",
];

/** Both map to real `intent.urgency` values the engine extracts per message (see
 * `Urgency` in src/domain/qualification.py) -- `QualificationService.evaluate()`
 * checks `intent.urgency.value in business_dna["human_escalation"]["triggers"]`
 * directly, so these are the actual, live escalation switches. The previous
 * three-checkbox version of this step was never sent to the backend at all. */
const ESCALATION_OPTIONS: [keyof EscalationState, string, string][] = [
  ["highUrgency", "Stop and hand off the moment high urgency is detected", "Off by default: the engine finishes qualifying, then hands you the lead with the urgency flagged. Turn on only if you want the cycle stopped immediately."],
  ["emergency", "Customer describes it as an emergency", "Always hands off immediately — no automated next step at all."],
];

const DEFAULT_QUESTION_SEED = ["What can we help you with?"];

interface EscalationState {
  highUrgency: boolean;
  emergency: boolean;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setUser, selectBusiness, token } = useAuth();

  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState({ name: "", industry: "", description: "", tone: "Friendly & direct" });
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [areaMode, setAreaMode] = useState<"remote" | "local" | null>(null);
  const [zips, setZips] = useState("");
  const [questions, setQuestions] = useState<Record<string, string[]>>({});
  // highUrgency defaults OFF to match the backend (2026-08-24, variant C in
  // claude/unit-economics-and-urgency-default.md). The backend defaults were
  // changed to false, but this wizard still sent true, so every real signup
  // kept the old immediate-stop behaviour and the default change never
  // reached a single business. High urgency now completes qualification and
  // then hands off with full context; checking this box opts back into
  // stopping the cycle the moment urgency is detected.
  const [escalation, setEscalation] = useState<EscalationState>({ highUrgency: false, emergency: true });
  const [launched, setLaunched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptedContinue, setAttemptedContinue] = useState(false);

  const zipList = useMemo(() => zips.split(",").map((z) => z.trim()).filter(Boolean), [zips]);

  const canContinue = useMemo(() => {
    switch (OB_STEPS[step].key) {
      case "basics":
        return business.name.trim().length > 0 && business.industry.trim().length > 0;
      case "services":
        return services.length > 0;
      case "area":
        return areaMode === "remote" || (areaMode === "local" && zipList.length > 0);
      default:
        return true;
    }
  }, [step, business, services, areaMode, zipList]);

  const next = () => {
    if (!canContinue) {
      setAttemptedContinue(true);
      return;
    }
    setAttemptedContinue(false);
    setStep((s) => Math.min(s + 1, OB_STEPS.length - 1));
  };
  const back = () => {
    setAttemptedContinue(false);
    setStep((s) => Math.max(s - 1, 0));
  };
  const addService = () => {
    const v = newService.trim();
    if (!v || services.some((s) => s.toLowerCase() === v.toLowerCase())) return;
    setServices([...services, v]);
    setNewService("");
  };

  async function launch() {
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const servicePayloads: OnboardingServicePayload[] = services.map((name) => ({
        name,
        questions: (questions[name] ?? DEFAULT_QUESTION_SEED).map((q) => q.trim()).filter(Boolean),
      }));

      const created = await api.createBusiness(token, {
        business_name: business.name.trim() || "Untitled business",
        industry: business.industry.trim(),
        description: business.description.trim(),
        tone: business.tone,
        services: servicePayloads,
        service_zip_codes: areaMode === "local" ? zipList : [],
        enforce_service_area: areaMode === "local",
        escalate_on_high_urgency: escalation.highUrgency,
        escalate_on_emergency: escalation.emergency,
      });

      if (user) {
        const business_ids = user.business_ids.includes(created.business_id)
          ? user.business_ids
          : [...user.business_ids, created.business_id];
        setUser({ ...user, business_id: created.business_id, business_ids });
        // This new business is clearly what the owner wants to look at next
        // -- switch to it regardless of whatever was previously selected.
        selectBusiness(created.business_id);
      }
      setLaunched(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ev-page min-h-screen w-full">
      <header className="border-b border-line bg-white">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#FF5A36", color: "#0B0B0D" }}
            >
              <EvoroveMark size={16} />
            </div>
            <span className="ev-wordmark text-[20px] tracking-[0.06em]">
              {user && user.business_ids.length > 0 ? "Setting up another business" : "Setting up your Business DNA"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-clay" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              Step {step + 1} / {OB_STEPS.length}
            </span>
            {user && user.business_ids.length > 0 && !launched && (
              <button onClick={() => navigate("/app")} className="text-xs font-medium text-mute flex items-center gap-1">
                <X size={13} /> Cancel
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 md:py-14 grid md:grid-cols-[200px_1fr] gap-10">
        <div className="hidden md:block"><ProgressRail current={step} /></div>

        <div className="bg-white rounded-2xl border border-line p-6 md:p-8 min-h-[480px] flex flex-col">
          {!launched ? (
            <>
              <div className="flex-1 dna-fade" key={step}>
                {step === 0 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">Tell us about your business</h2>
                    <p className="text-sm text-mute mb-7">This shapes how your engine talks to every customer — works for any kind of business.</p>
                    <Field label="Business name">
                      <input className={inputCls} placeholder="e.g. Acme Studio" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} />
                      {attemptedContinue && !business.name.trim() && <p className="text-xs mt-1.5" style={{ color: "#B4483A" }}>Give it a name to continue.</p>}
                    </Field>
                    <Field label="Industry">
                      <input
                        className={inputCls}
                        list="industry-suggestions"
                        placeholder="e.g. Consulting, Real estate, E-commerce…"
                        value={business.industry}
                        onChange={(e) => setBusiness({ ...business, industry: e.target.value })}
                      />
                      <datalist id="industry-suggestions">
                        {INDUSTRY_SUGGESTIONS.map((i) => (
                          <option key={i} value={i} />
                        ))}
                      </datalist>
                      {attemptedContinue && !business.industry.trim() && <p className="text-xs mt-1.5" style={{ color: "#B4483A" }}>Type your industry — anything works.</p>}
                    </Field>
                    {/* Optional, but it is what lets the engine understand a
                        customer's own wording ("my roof is leaking") without
                        anyone configuring keyword synonyms -- see
                        AIIntentExtractor._business_context. */}
                    <Field label="What does your business do? (optional)">
                      <textarea
                        className={`${inputCls} min-h-[76px] resize-y`}
                        placeholder="e.g. Family law practice handling divorce, custody and child support"
                        maxLength={1000}
                        value={business.description}
                        onChange={(e) => setBusiness({ ...business, description: e.target.value })}
                      />
                      <p className="text-xs mt-1.5 text-mute">
                        A sentence in plain language. It helps your engine recognise what customers are asking for when they describe it in their own words.
                      </p>
                    </Field>
                    <Field label="How should it sound to customers?">
                      <div className="grid sm:grid-cols-3 gap-2.5">
                        {TONE_OPTIONS.map(([label, desc]) => (
                          <ToneOption key={label} label={label} desc={desc} active={business.tone === label} onClick={() => setBusiness({ ...business, tone: label })} />
                        ))}
                      </div>
                    </Field>
                  </>
                )}

                {step === 1 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">What do you offer?</h2>
                    <p className="text-sm text-mute mb-7">
                      Every service starts routed to you for review — nothing auto-books or auto-quotes until you turn that on later.
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {services.map((s) => (
                        <span key={s} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-[#F1F1EF] border border-line">
                          {s} <X size={12} className="cursor-pointer text-clay" onClick={() => setServices(services.filter((x) => x !== s))} />
                        </span>
                      ))}
                      {services.length === 0 && <span className="text-xs text-clay">No services yet — add at least one below.</span>}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className={inputCls}
                        placeholder="e.g. Consulting call, Product demo, Initial diagnosis"
                        value={newService}
                        onChange={(e) => setNewService(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addService())}
                      />
                      <button type="button" onClick={addService} className="px-4 rounded-lg text-white text-sm font-medium flex items-center gap-1.5 shrink-0" style={{ backgroundColor: "#0B0B0D" }}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                    {attemptedContinue && services.length === 0 && <p className="text-xs mt-2.5" style={{ color: "#B4483A" }}>Add at least one to continue.</p>}
                  </>
                )}

                {step === 2 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">Who can you serve?</h2>
                    <p className="text-sm text-mute mb-7">This decides which leads book automatically and which ones escalate to you instead.</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <AreaOption
                        icon={Globe}
                        label="Serve customers anywhere"
                        desc="For remote, online, or nationwide businesses. Location never disqualifies a lead."
                        active={areaMode === "remote"}
                        onClick={() => setAreaMode("remote")}
                      />
                      <AreaOption
                        icon={MapPin}
                        label="Only selected ZIP codes"
                        desc="Use this when travel or licensing limits where you can serve. Leads outside the list won't book automatically."
                        active={areaMode === "local"}
                        onClick={() => setAreaMode("local")}
                      />
                    </div>
                    {areaMode === "local" && (
                      <div className="mt-5 dna-fade">
                        <Field label="Known service zip codes" hint="Comma-separated — the engine matches against these first.">
                          <textarea className={inputCls} rows={3} placeholder="e.g. 60601, 60602, 60603" value={zips} onChange={(e) => setZips(e.target.value)} />
                        </Field>
                        {attemptedContinue && zipList.length === 0 && <p className="text-xs mt-1.5" style={{ color: "#B4483A" }}>Add at least one zip code, or choose "Anywhere" above.</p>}
                      </div>
                    )}
                    {attemptedContinue && areaMode === null && <p className="text-xs mt-3" style={{ color: "#B4483A" }}>Pick one to continue.</p>}
                  </>
                )}

                {step === 3 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">What does it need to ask?</h2>
                    <p className="text-sm text-mute mb-7">Per service, the questions your engine confirms before qualifying a lead.</p>
                    {services.map((svc) => (
                      <div key={svc} className="mb-5 pb-5 border-b border-[#F0EFE9] last:border-0">
                        <div className="text-sm font-semibold mb-2.5">{svc}</div>
                        <div className="flex flex-col gap-2">
                          {(questions[svc] || DEFAULT_QUESTION_SEED).map((q, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-clay w-5 shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{i + 1}</span>
                              <input
                                className={inputCls}
                                value={q}
                                onChange={(e) => {
                                  const qs = [...(questions[svc] || DEFAULT_QUESTION_SEED)];
                                  qs[i] = e.target.value;
                                  setQuestions({ ...questions, [svc]: qs });
                                }}
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-xs font-medium text-coral flex items-center gap-1 mt-0.5 ml-7"
                            onClick={() => setQuestions({ ...questions, [svc]: [...(questions[svc] || DEFAULT_QUESTION_SEED), ""] })}
                        >
                            <Plus size={12} /> Add question
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {step === 4 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">When should it hand off to you?</h2>
                    <p className="text-sm text-mute mb-7">The engine never guesses past these lines — it stops and asks.</p>
                    <div className="flex flex-col gap-3">
                      {ESCALATION_OPTIONS.map(([key, title, desc]) => (
                        <label
                          key={key}
                          className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer"
                          style={{
                            borderColor: escalation[key] ? "#FF5A36" : "#E4DCCB",
                            backgroundColor: escalation[key] ? "#FFE8E1" : "#fff",
                          }}
                      >
                          <input
                            type="checkbox"
                            checked={escalation[key]}
                            onChange={() => setEscalation({ ...escalation, [key]: !escalation[key] })}
                            className="mt-0.5 accent-coral"
                          />
                          <div>
                            <div className="text-sm font-medium">{title}</div>
                            <div className="text-xs text-mute mt-0.5">{desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {step === 5 && (
                  <>
                    <h2 className="ev-display text-4xl mb-1.5">Ready to go live</h2>
                    <p className="text-sm text-mute mb-7">Here's the Business DNA your engine will run on.</p>
                    <div className="rounded-xl bg-cream border border-line p-5 flex flex-col gap-4 text-sm">
                      <div className="flex justify-between"><span className="text-mute">Business</span><span className="font-medium">{business.name || "Untitled business"} · {business.industry}</span></div>
                      <div className="flex justify-between"><span className="text-mute">Voice</span><span className="font-medium">{business.tone}</span></div>
                      <div className="flex justify-between"><span className="text-mute">Services</span><span className="font-medium text-right">{services.join(", ")}</span></div>
                      <div className="flex justify-between">
                        <span className="text-mute">Service area</span>
                        <span className="font-medium">{areaMode === "remote" ? "Anywhere (remote)" : `${zipList.length} zip code${zipList.length === 1 ? "" : "s"}`}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-mute">Escalates to you on</span>
                        <span className="font-medium text-right">
                          {[escalation.highUrgency && "High urgency (immediately)", escalation.emergency && "Emergency"].filter(Boolean).join(", ") || "Emergencies only"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-5 text-xs" style={{ color: "#1E7B52" }}>
                      <Check size={14} /> Every service starts on human review — nothing books or quotes itself until you turn that on.
                    </div>
                    {error && (
                      <div className="mt-4 text-sm px-3.5 py-2.5 rounded-lg" style={{ color: "#B4483A", backgroundColor: "#FBEBE9" }}>
                        {error}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between pt-6 mt-6 border-t border-[#F0EFE9]">
                <button onClick={back} disabled={step === 0} className="text-sm font-medium px-4 py-2.5 rounded-lg flex items-center gap-1.5 disabled:opacity-0" style={{ color: "#6B6459" }}>
                  <ArrowLeft size={14} /> Back
                </button>
                {step < OB_STEPS.length - 1 ? (
                  <button onClick={next} className="text-sm font-medium text-white px-5 py-2.5 rounded-lg flex items-center gap-1.5" style={{ backgroundColor: "#0B0B0D" }}>
                    Continue <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    onClick={launch}
                    disabled={submitting}
                    className="text-sm font-medium text-white px-5 py-2.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
                    style={{ backgroundColor: "#1E7B52" }}
                >
                    {submitting ? "Launching…" : "Launch engine"}
                    {/* The torus as a progress indicator while Business DNA
                        assembles, then Sparkles once ready. */}
                    {submitting ? <EvoroveMark size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center dna-fade">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: "#E9F5EF" }}>
                <Check size={22} color="#1E7B52" />
              </div>
              <h2 className="ev-display text-4xl mb-2">
                {business.name || "Your business"} is live.
              </h2>
              <p className="text-sm text-mute mb-7 max-w-sm">It's answering new leads right now, using exactly what you just set up.</p>
              <button
                onClick={() => navigate("/app")}
                className="text-sm font-medium text-white px-5 py-2.5 rounded-lg flex items-center gap-1.5"
                style={{ backgroundColor: "#0B0B0D" }}
            >
                Go to dashboard <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
