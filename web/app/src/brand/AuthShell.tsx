import { Suspense, lazy, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LEGAL_NAV } from "../content/legal";
import { BrandLink } from "./BrandLockup";

const OrbitScene = lazy(() => import("./OrbitScene").then((mod) => ({ default: mod.OrbitScene })));

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="ev-page relative min-h-screen overflow-x-hidden overflow-y-auto flex items-center justify-center px-6 py-10">
      <div className="absolute inset-0 pointer-events-none opacity-80">
        <Suspense fallback={null}>
          <OrbitScene variant="ambient" />
        </Suspense>
      </div>
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandLink to="/" />
        </div>
        {children}
        <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-clay mt-6">
          {LEGAL_NAV.map((item) => (
            <Link key={item.to} to={item.to} className="hover:text-ink transition-colors">
              {item.label}
            </Link>
          ))}
        </p>
      </div>
    </div>
  );
}
