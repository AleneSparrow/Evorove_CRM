import { useEffect, useState, type ComponentType } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutGrid, MessageSquare, Workflow, CreditCard, LogOut, Menu, X, Plus, Check, ChevronsUpDown, Home, HelpCircle, User } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type OwnedBusiness } from "../api/client";
import { EvoroveMark } from "./Shared";
import { brand } from "../brand/theme";

/** Dropdown for switching between the account's businesses -- only rendered
 * when there's more than one (see Sidebar). Also offers "Add another
 * business", the entry point back into /onboarding now that it's reachable
 * any time (see App.tsx). */
function BusinessSwitcher({
  businesses,
  activeId,
  onSelect,
  onAddBusiness,
}: {
  businesses: OwnedBusiness[];
  activeId: string | null;
  onSelect: (businessId: string) => void;
  onAddBusiness: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = businesses.find((b) => b.business_id === activeId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1.5 text-left"
    >
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight truncate">{active?.name ?? "Your business"}</div>
        </div>
        <ChevronsUpDown size={13} className="shrink-0" style={{ color: "#9A8F83" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white rounded-lg border border-line shadow-lg py-1.5 overflow-hidden">
            {businesses.map((b) => (
              <button
                key={b.business_id}
                onClick={() => {
                  setOpen(false);
                  if (b.business_id !== activeId) onSelect(b.business_id);
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-cream"
                style={{ color: "#0B0B0D" }}
            >
                <span className="truncate">{b.name}</span>
                {b.business_id === activeId && <Check size={13} style={{ color: "#1E7B52" }} className="shrink-0" />}
              </button>
            ))}
            <div className="border-t border-[#F0EFE9] mt-1 pt-1">
              <button
                onClick={() => {
                  setOpen(false);
                  onAddBusiness();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-cream"
                style={{ color: "#FF5A36" }}
            >
                <Plus size={13} className="shrink-0" /> Add another business
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function navVisual(active: boolean) {
  return {
    color: active ? brand.ink : brand.mute,
    backgroundColor: active ? brand.lime : "transparent",
    fontWeight: active ? 600 : 500,
  };
}

function NavItem({
  icon: Icon,
  label,
  to,
  end,
  active = false,
  onClick,
}: {
  // size and strokeWidth are both `string | number` on lucide-react's own
  // prop type -- widened to match, same fix as AreaOption in Shared.tsx.
  icon: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  label: string;
  to?: string;
  end?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left";
  const inner = (
    <>
      <Icon size={17} strokeWidth={2} />
      {label}
    </>
  );
  if (to) {
    return (
      <NavLink to={to} end={end} onClick={onClick} className={className} style={({ isActive }) => navVisual(isActive)}>
        {inner}
      </NavLink>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} style={navVisual(active)}>
      {inner}
    </button>
  );
}

/** The app shell's nav is otherwise desktop-only (see the `aside` below) --
 * on a phone there was previously no way at all to reach another page once
 * RequireActiveSubscription (see RouteGuards.tsx) redirected a business
 * without billing access to /app/billing: no sidebar, no back button,
 * nothing. This renders as a fixed overlay so it doesn't disturb the
 * desktop flex layout in Dashboard/Conversation/Settings/Billing -- each of
 * those pages just needs `pt-14 md:pt-0` on its `<main>` to clear it. */
function MobileNav({
  businesses,
  businessId,
  businessName,
  email,
  onNavigate,
  onSelectBusiness,
  onLogout,
}: {
  businesses: OwnedBusiness[];
  businessId: string | null;
  businessName: string | null;
  email: string | undefined;
  onNavigate: (path: string) => void;
  onSelectBusiness: (businessId: string) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  const go = (path: string) => {
    setOpen(false);
    onNavigate(path);
  };

  return (
    <div className="md:hidden">
      <div
        className="fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 border-b border-line"
        style={{ height: 56, backgroundColor: brand.cream }}
      >
        <button onClick={() => go("/app")} className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: brand.coral, color: brand.ink }}
          >
            <EvoroveMark size={16} />
          </div>
          <div className="text-left min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">{businessName ?? "Your business"}</div>
          </div>
        </button>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-2 -mr-2 shrink-0"
          style={{ color: "#0B0B0D" }}
      >
          <Menu size={20} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative w-64 max-w-[80%] h-full bg-white px-4 py-5 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-start justify-between mb-6 px-2 gap-2">
                <div className="min-w-0 flex-1">
                  {businesses.length > 1 ? (
                    <BusinessSwitcher
                      businesses={businesses}
                      activeId={businessId}
                      onSelect={(id) => {
                        setOpen(false);
                        onSelectBusiness(id);
                      }}
                      onAddBusiness={() => go("/onboarding")}
                    />
                  ) : (
                    <div className="text-sm font-semibold leading-tight truncate">{businessName ?? "Your business"}</div>
                  )}
                  <NavLink
                    to="/app/account"
                    aria-label="Open personal account"
                    onClick={() => setOpen(false)}
                    className="block max-w-full text-[11px] text-mute leading-tight truncate rounded-sm hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 transition-colors"
                >
                    {email}
                  </NavLink>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-1 shrink-0" style={{ color: "#6B6459" }}>
                  <X size={18} />
                </button>
              </div>
              <nav className="flex flex-col gap-1">
                <NavItem icon={LayoutGrid} label="Overview" to="/app" end onClick={() => setOpen(false)} />
                <NavItem icon={MessageSquare} label="Conversations" to="/app/conversations" onClick={() => setOpen(false)} />
                <NavItem icon={Workflow} label="Settings" to="/app/settings" onClick={() => setOpen(false)} />
                <NavItem icon={CreditCard} label="Billing" to="/app/billing" onClick={() => setOpen(false)} />
                <NavItem icon={Plus} label="Add another business" to="/onboarding" onClick={() => setOpen(false)} />
                <div className="border-t border-[#F0EFE9] mt-3 pt-3">
                  <NavItem icon={User} label="Account" to="/app/account" onClick={() => setOpen(false)} />
                  <NavItem icon={HelpCircle} label="FAQ" to="/app/faq" onClick={() => setOpen(false)} />
                </div>
              </nav>
            </div>
            <div>
              <div className="px-3 mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-clay">
                <NavLink to="/privacy" onClick={() => setOpen(false)} className="hover:text-ink">Privacy</NavLink>
                <NavLink to="/terms" onClick={() => setOpen(false)} className="hover:text-ink">Terms</NavLink>
                <NavLink to="/dpa" onClick={() => setOpen(false)} className="hover:text-ink">DPA</NavLink>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-mute"
            >
                <LogOut size={16} strokeWidth={2} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const { user, token, businessId, selectBusiness, logout } = useAuth();
  const [businesses, setBusinesses] = useState<OwnedBusiness[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !user || user.business_ids.length === 0) {
      setBusinesses([]);
      return;
    }
    api
      .listMyBusinesses(token)
      .then((list) => {
        if (!cancelled) setBusinesses(list);
      })
      .catch(() => {
        if (!cancelled) setBusinesses([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.user_id, businessId]);

  const businessName = businesses.find((b) => b.business_id === businessId)?.name ?? null;

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <>
      <MobileNav
        businesses={businesses}
        businessId={businessId}
        businessName={businessName}
        email={user?.email}
        onNavigate={(path) => navigate(path)}
        onSelectBusiness={selectBusiness}
        onLogout={handleLogout}
      />
      <aside className="w-60 shrink-0 border-r border-line px-4 py-5 hidden md:flex md:flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 px-2 mb-8">
            <button
              onClick={() => navigate("/app")}
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: brand.coral, color: brand.ink }}
            >
              <EvoroveMark size={16} />
            </button>
            <div className="min-w-0 flex-1">
              {businesses.length > 1 ? (
                <BusinessSwitcher
                  businesses={businesses}
                  activeId={businessId}
                  onSelect={selectBusiness}
                  onAddBusiness={() => navigate("/onboarding")}
                />
              ) : (
                <button onClick={() => navigate("/app")} className="text-left w-full">
                  <div className="text-sm font-semibold leading-tight truncate">{businessName ?? "Your business"}</div>
                </button>
              )}
              <NavLink
                to="/app/account"
                aria-label="Open personal account"
                className="block max-w-full text-[11px] text-mute leading-tight truncate rounded-sm hover:text-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 transition-colors"
            >
                {user?.email}
              </NavLink>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            <NavItem icon={LayoutGrid} label="Overview" to="/app" end />
            <NavItem icon={MessageSquare} label="Conversations" to="/app/conversations" />
            <NavItem icon={Workflow} label="Settings" to="/app/settings" />
            <NavItem icon={CreditCard} label="Billing" to="/app/billing" />
            <NavItem icon={Plus} label="Add another business" to="/onboarding" />
            <div className="border-t border-[#F0EFE9] mt-3 pt-3">
              <NavItem icon={User} label="Account" to="/app/account" />
              <NavItem icon={HelpCircle} label="FAQ" to="/app/faq" />
            </div>
          </nav>
        </div>
        <div>
          <NavItem icon={Home} label="Home page" to="/" end />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-mute hover:text-ink transition-colors"
        >
            <LogOut size={16} strokeWidth={2} /> Sign out
          </button>
          <div className="px-2 mt-3 text-[11px] text-clay leading-relaxed">
            Every step your engine takes — logged, reversible, never silent.
          </div>
          <div className="px-2 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-clay">
            <NavLink to="/privacy" className="hover:text-ink">Privacy</NavLink>
            <NavLink to="/terms" className="hover:text-ink">Terms</NavLink>
            <NavLink to="/dpa" className="hover:text-ink">DPA</NavLink>
          </div>
        </div>
      </aside>
    </>
  );
}
