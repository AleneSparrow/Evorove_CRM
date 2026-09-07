import { FAQ_ITEMS } from "../content/faq";

export function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="py-5 border-b border-line last:border-0">
      <div className="text-sm font-semibold mb-1.5">{q}</div>
      <div className="text-sm text-mute leading-relaxed">{a}</div>
    </div>
  );
}

export function FaqList() {
  return (
    <div>
      {FAQ_ITEMS.map((item) => (
        <FaqItem key={item.q} q={item.q} a={item.a} />
      ))}
    </div>
  );
}

export function FaqSection({ headingLevel = "h2", standalone = false }: { headingLevel?: "h1" | "h2"; standalone?: boolean }) {
  const Heading = headingLevel;
  return (
    <section id="faq" className={standalone ? "" : "border-t border-line"}>
      <div className="max-w-2xl mx-auto px-6 py-16 md:py-20">
        <span className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: "#FF5A36" }}>FAQ</span>
        <Heading
          className="ev-display text-5xl md:text-6xl mt-2 mb-6"
      >
          What people ask before they start
        </Heading>
        <FaqList />
      </div>
    </section>
  );
}
