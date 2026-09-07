import { Link, useNavigate } from "react-router-dom";
import { PRODUCT_NAME, brand } from "./theme";

/** Pulse mark: a torus ring, the same object as the 3D hero. */
export function EvoroveMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M20.6 8.8 A9 9 0 0 1 21.4 13.2" stroke="currentColor" strokeWidth="1.6" opacity="0.45" strokeLinecap="round" />
    </svg>
  );
}

function MarkBadge() {
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ev-mark-spin"
      style={{ background: brand.coral, color: brand.ink }}
    >
      <EvoroveMark size={15} />
    </span>
  );
}

export function BrandLockup({
  to = "/",
  inverted = false,
}: {
  to?: string;
  inverted?: boolean;
}) {
  const navigate = useNavigate();
  const ink = inverted ? brand.cream : brand.ink;
  return (
    <button type="button" onClick={() => navigate(to)} className="flex items-center gap-2.5" style={{ color: ink }}>
      <MarkBadge />
      <span className="ev-wordmark text-[22px] leading-none tracking-[0.06em]">{PRODUCT_NAME}</span>
    </button>
  );
}

export function BrandLink({ to = "/", inverted = false }: { to?: string; inverted?: boolean }) {
  const ink = inverted ? brand.cream : brand.ink;
  return (
    <Link to={to} className="flex items-center gap-2.5" style={{ color: ink }}>
      <MarkBadge />
      <span className="ev-wordmark text-[22px] leading-none tracking-[0.06em]">{PRODUCT_NAME}</span>
    </Link>
  );
}
