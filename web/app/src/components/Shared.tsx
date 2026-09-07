import type { ComponentType, ReactNode } from "react";
import type { ProcessState } from "../api/client";
import { brand } from "../brand/theme";

/**
 * Shared cabinet primitives. Visual tokens come from `brand` (Pulse).
 */

/**
 * The five steps of the DEAL, in the owner's words -- this is what the
 * "Where this case is" stepper shows.
 *
 * It used to read Trigger / Context / Decision / Action / Result. Those are
 * the engine's five phases for processing ONE MESSAGE (arrived, understood,
 * decided, replied, state written), which is a debugging view: every message
 * walks all five, so the stepper told the owner nothing about the deal and
 * the audit trail looked like the same four lines on a loop. The owner's
 * question is never "which phase is this message in", it is "where is this
 * deal". The indices below are unchanged -- mapProcessState already derived
 * them from the CASE state, not from events, so only the words were wrong.
 */
export const STAGES = ["New", "Contacted", "Qualified", "Booked", "Completed"];

export type CaseState = "NEW" | "QUALIFYING" | "NEEDS_HUMAN" | "BOOKED" | "LOST" | "COMPLETED";

// QUALIFYING uses Pulse coral: the lead is in motion. Lime is reserved for
// "needs you" and other human/CTA states. Resting states stay mute or ink.
export const STATE_META: Record<CaseState, { label: string; color: string; bg: string }> = {
  NEW: { label: "New", color: brand.mute, bg: "#F1F1EF" },
  QUALIFYING: { label: "Qualifying", color: brand.coral, bg: brand.coralWash },
  NEEDS_HUMAN: { label: "Needs you", color: brand.limeInk, bg: brand.limeWash },
  BOOKED: { label: "Booked", color: "#1E7B52", bg: "#E9F5EF" },
  LOST: { label: "Lost", color: "#B4483A", bg: "#FBEBE9" },
  COMPLETED: { label: "Completed", color: brand.ink, bg: "#F1F1EF" },
};

export { EvoroveMark, EvoroveMark as FlywheelMark } from "../brand/BrandLockup";

/**
 * The real engine has more states than the UI's simplified five-bucket view
 * (`src/domain/states.py::ProcessState`) — this collapses them for display.
 * Also returns a 0–4 "stage" index into STAGES for the progress dots; this is
 * an approximation for the visual, not something the backend tracks directly.
 */
export function mapProcessState(state: ProcessState): { caseState: CaseState; stage: number } {
  switch (state) {
    case "NEW_LEAD":
      return { caseState: "NEW", stage: 0 };
    case "CONTACTED":
      return { caseState: "QUALIFYING", stage: 1 };
    case "QUALIFYING":
      return { caseState: "QUALIFYING", stage: 1 };
    case "QUALIFIED":
      return { caseState: "QUALIFYING", stage: 2 };
    case "NEEDS_HUMAN":
      return { caseState: "NEEDS_HUMAN", stage: 2 };
    case "BOOKED":
    case "QUOTED":
      return { caseState: "BOOKED", stage: 3 };
    case "FOLLOW_UP":
      return { caseState: "QUALIFYING", stage: 3 };
    case "WON":
    case "PAID":
      return { caseState: "BOOKED", stage: 4 };
    case "COMPLETED":
    case "REVIEW_REQUESTED":
      return { caseState: "COMPLETED", stage: 4 };
    case "REACTIVATION":
      return { caseState: "QUALIFYING", stage: 1 };
    case "LOST":
    case "CANCELLED":
      return { caseState: "LOST", stage: 2 };
    default:
      return { caseState: "NEW", stage: 0 };
  }
}

/**
 * event_type -> (what kind of step it was, human-readable summary) for the
 * audit trail.
 *
 * `stage` here is deliberately NOT the deal stage above -- it says what the
 * engine DID on that line. It used to borrow the old Trigger/Context/
 * Decision/Action/Result words, which made the audit trail read like
 * engineering telemetry; these are the same distinctions in plain English.
 */
const EVENT_TYPE_META: Record<string, { stage: string; label: string }> = {
  TRIGGER_RECEIVED: { stage: "Received", label: "Inbound message received" },
  LEAD_INTAKE_RECEIVED: { stage: "Received", label: "Lead intake received" },
  INTENT_EXTRACTED: { stage: "Understood", label: "Customer intent understood" },
  QUALIFICATION_EVALUATED: { stage: "Decided", label: "Qualification evaluated" },
  DECISION_RECORDED: { stage: "Decided", label: "Decision recorded" },
  CUSTOMER_RESPONSE_CREATED: { stage: "Replied", label: "Reply sent to customer" },
  STATE_CHANGED: { stage: "Updated", label: "Case moved to a new stage" },
  TRANSITION_REJECTED: { stage: "Updated", label: "Transition rejected" },
  DUPLICATE_IGNORED: { stage: "Updated", label: "Duplicate message ignored" },
  LEAD_QUALIFICATION_TRANSITION: { stage: "Decided", label: "Qualification stage updated" },
  HUMAN_REPLY_SENT: { stage: "Replied", label: "Staff replied to customer" },
  CALLBACK_REQUESTED: { stage: "Follow-up", label: "Customer asked for a callback" },
  SALES_FOLLOW_UP_SENT: { stage: "Follow-up", label: "Sales follow-up sent" },
};

export function describeEvent(eventType: string): { stage: string; label: string } {
  return EVENT_TYPE_META[eventType] ?? { stage: "Event", label: eventType };
}

/** "2m ago" / "3h ago" / "5d ago" style relative time from an ISO timestamp. */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Dots and their captions share ONE grid, so a caption always sits under its
 * own dot. They used to be two independent rows -- fixed-width dots packed
 * left, captions spread across the full width with justify-between -- which
 * only looked aligned while the words were as short as "Trigger" and
 * "Result". With the real deal stages ("Contacted", "Completed") the two rows
 * visibly disagreed about which step was which.
 *
 * Pass `labels` on the detail panels; the list rows want the dots alone.
 */
export function Stepper({ stage, color = brand.coral, labels = false }: {
  stage: number;
  color?: string;
  labels?: boolean;
}) {
  const columns = { gridTemplateColumns: `repeat(${STAGES.length}, minmax(0, 1fr))` };
  return (
    <div className="w-full">
      <div className="grid items-center" style={columns}>
        {STAGES.map((label, i) => (
          <div key={label} className="flex items-center min-w-0">
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: i <= stage ? color : brand.line,
                boxShadow: i === stage ? `0 0 0 3px ${color}22` : "none",
              }}
              title={label}
            />
            {i < STAGES.length - 1 && (
              <div className="h-px flex-1 mx-1.5" style={{ backgroundColor: i < stage ? color : brand.line }} />
            )}
          </div>
        ))}
      </div>
      {labels && (
        <div className="grid mt-1.5" style={columns}>
          {STAGES.map((label) => (
            <span key={label} className="text-[10px] leading-tight text-clay break-words pr-1">{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatePill({ state }: { state: CaseState }) {
  const m = STATE_META[state];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ color: m.color, backgroundColor: m.bg }}
    >
      {m.label}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {hint && <p className="text-xs text-clay mb-2">{hint}</p>}
      {children}
    </div>
  );
}

export const inputCls =
  "w-full px-3.5 py-2.5 rounded-lg border border-line bg-white text-sm outline-none focus:ring-2 focus:ring-coral/20 focus:border-coral transition-shadow";

/** Used on both Onboarding's "Who can you serve?" step and Settings' "Service
 * area" tab, so a remote/local choice looks and behaves identically wherever
 * it's edited. */
export function AreaOption({
  icon: Icon,
  label,
  desc,
  active,
  onClick,
}: {
  // lucide-react icons type `size` as `string | number`, not just `number` --
  // widened to match so passing Globe/MapPin here type-checks under `tsc -b`
  // (this prop previously only worked because it was never actually built
  // with project-reference mode; `npm run dev` doesn't run this check).
  icon: ComponentType<{ size?: number | string }>;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-4 rounded-xl border transition-colors flex flex-col gap-2.5"
      style={{ borderColor: active ? brand.coral : brand.line, backgroundColor: active ? brand.coralWash : "#fff" }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: active ? brand.coral : "#F1F1EF", color: active ? brand.ink : brand.mute }}
      >
        <Icon size={15} />
      </div>
      <div>
        <div className="text-sm font-medium mb-0.5">{label}</div>
        <div className="text-xs text-mute leading-relaxed">{desc}</div>
      </div>
    </button>
  );
}

export function ToneOption({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left px-4 py-3 rounded-xl border transition-colors"
      style={{ borderColor: active ? brand.coral : brand.line, backgroundColor: active ? brand.coralWash : "#fff" }}
    >
      <div className="text-sm font-medium mb-0.5">{label}</div>
      <div className="text-xs text-mute">{desc}</div>
    </button>
  );
}

/** Shown on preview-data screens (Dashboard/Conversation/Settings) until the staff
 * dashboard/conversation API (Milestone 8 slice 2) exists. Keeps the prototype's
 * mock content honest instead of implying it's live. */
export function PreviewBanner({ text }: { text: string }) {
  return (
    <div
      className="px-4 py-2.5 text-xs font-medium flex items-center gap-2"
      style={{ backgroundColor: brand.coralWash, color: brand.coralDeep, borderBottom: `1px solid ${brand.line}` }}
    >
      {text}
    </div>
  );
}
