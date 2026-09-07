import { useEffect } from "react";
import { FaqList } from "../components/FaqSection";
import { Sidebar } from "../components/Sidebar";

/** In-app FAQ, separate from the personal account and from the public /faq page. */
export default function AppFaq() {
  useEffect(() => {
    document.title = "FAQ · Evorove";
    return () => {
      document.title = "Evorove — every lead. no dead air.";
    };
  }, []);

  return (
    <div className="ev-page min-h-screen flex">
      <Sidebar />
      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10 md:py-12">
          <div className="mb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-coral">FAQ</p>
            <h1 className="text-3xl font-semibold tracking-tight mt-2">What people ask before they start</h1>
            <p className="text-sm text-mute mt-2">Straight answers about what Evorove does and does not do.</p>
          </div>
          <section className="max-w-2xl border border-line bg-white rounded-xl p-5 sm:p-6">
            <FaqList />
          </section>
        </div>
      </main>
    </div>
  );
}
