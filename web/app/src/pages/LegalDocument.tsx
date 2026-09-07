import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MarketingFooter, MarketingHeader } from "../brand/MarketingChrome";
import { brand, DOCUMENT_TITLE } from "../brand/theme";
import {
  LEGAL_DOCS,
  LEGAL_NAV,
  LEGAL_UPDATED,
  type LegalBlock,
  type LegalDocId,
} from "../content/legal";

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[\[([^|]+)\|([^\]]+)\]\]$/);
    if (!match) return part;
    const [, to, label] = match;
    return (
      <Link
        key={`${to}-${index}`}
        to={to}
        className="font-medium underline decoration-line underline-offset-2 hover:text-ink"
        style={{ color: brand.coralDeep }}
      >
        {label}
      </Link>
    );
  });
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "p") {
    return <p className="text-sm text-mute leading-relaxed mb-4">{linkify(block.text)}</p>;
  }
  if (block.type === "note") {
    return (
      <p
        className="text-sm leading-relaxed mb-4 px-4 py-3 rounded-lg"
        style={{ background: brand.limeWash, color: brand.ink }}
      >
        {linkify(block.text)}
      </p>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="text-sm text-mute leading-relaxed mb-4 list-disc pl-5 space-y-2">
        {block.items.map((item) => (
          <li key={item.slice(0, 48)}>{linkify(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-6 overflow-x-auto border border-line rounded-xl bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ background: brand.panel }}>
            {block.headers.map((header) => (
              <th key={header} className="px-4 py-3 font-semibold text-ink whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} className="border-t border-line">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${row[0]}-${cellIndex}`}
                  className={`px-4 py-3 text-mute leading-relaxed ${cellIndex === 0 ? "font-medium text-ink whitespace-nowrap" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalDocument({ docId }: { docId: LegalDocId }) {
  const doc = LEGAL_DOCS[docId];

  useEffect(() => {
    document.title = `${doc.eyebrow} · Evorove`;
    window.scrollTo(0, 0);
    return () => {
      document.title = DOCUMENT_TITLE;
    };
  }, [docId, doc.eyebrow]);

  return (
    <div className="ev-page min-h-screen w-full">
      <MarketingHeader />
      <article className="max-w-2xl mx-auto px-6 py-16 md:py-20">
        <span className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: brand.coral }}>
          {doc.eyebrow}
        </span>
        <h1 className="ev-display text-5xl md:text-6xl mt-2 mb-3">{doc.title}</h1>
        <p className="text-xs uppercase tracking-[0.16em] text-clay mb-8">Last updated {LEGAL_UPDATED}</p>
        <p className="text-base text-ink leading-relaxed mb-10">{linkify(doc.summary)}</p>
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="mb-10">
            <h2 className="text-lg font-semibold text-ink mb-3">{section.title}</h2>
            {section.blocks.map((block, index) => (
              <Block key={`${section.id}-${index}`} block={block} />
            ))}
          </section>
        ))}
        <nav className="pt-6 border-t border-line flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="hover:text-ink transition-colors"
              style={{ color: item.to === `/${docId}` ? brand.ink : brand.mute, fontWeight: item.to === `/${docId}` ? 600 : 500 }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </article>
      <MarketingFooter />
    </div>
  );
}
