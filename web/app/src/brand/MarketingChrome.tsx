import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { LEGAL_NAV } from "../content/legal";
import { BrandLockup } from "./BrandLockup";
import { PRODUCT_NAME, brand } from "./theme";

export function MarketingHeader({
  homeTo = "/",
  ctaLabel,
  links = [
    { href: "/#how", label: "Cycle" },
    { href: "/#features", label: "Engine" },
    { href: "/#trust", label: "Audit" },
    { href: "/faq", label: "FAQ" },
  ],
}: {
  homeTo?: string;
  ctaLabel?: string;
  links?: { href: string; label: string }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const primaryCtaTarget = user ? (user.business_ids.length > 0 ? "/app" : "/onboarding") : "/signup";
  const label = ctaLabel ?? (user ? "Go to dashboard" : "Get started");

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md" style={{ background: "rgba(247,241,228,0.88)", borderBottom: `1px solid ${brand.line}` }}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandLockup to={homeTo} />
        <nav className="hidden md:flex items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.22em] text-mute">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink transition-colors">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-3">
          {!user && (
            <button onClick={() => navigate("/login")} className="text-sm font-medium text-mute">
              Sign in
            </button>
          )}
          <button
            onClick={() => navigate(primaryCtaTarget)}
            className="text-[11px] font-bold uppercase tracking-[0.14em] px-4 py-2 rounded-full inline-flex items-center gap-1.5"
            style={{ backgroundColor: brand.lime, color: brand.ink }}
          >
            {label} <ArrowRight size={14} />
          </button>
        </div>
        <button className="md:hidden text-ink" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <div className="md:hidden px-6 pb-4 flex flex-col gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-mute">
          {links.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
          {!user && <button onClick={() => navigate("/login")} className="text-left">Sign in</button>}
          <button
            onClick={() => navigate(primaryCtaTarget)}
            className="font-bold px-4 py-2 rounded-full mt-1"
            style={{ backgroundColor: brand.lime, color: brand.ink }}
          >
            {label}
          </button>
        </div>
      )}
    </header>
  );
}

export function MarketingFooter({ extra }: { extra?: ReactNode }) {
  return (
    <footer className="border-t py-8" style={{ borderColor: brand.line }}>
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs text-clay">
        <span>© 2026 {PRODUCT_NAME}</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {extra}
          {LEGAL_NAV.map((item) => (
            <Link key={item.to} to={item.to} className="hover:text-ink transition-colors">
              {item.label}
            </Link>
          ))}
          <Link to="/faq" className="hover:text-ink transition-colors">FAQ</Link>
        </div>
      </div>
    </footer>
  );
}
