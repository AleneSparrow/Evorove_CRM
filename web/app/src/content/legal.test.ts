import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenLegalDocument, LEGAL_CONTACT_EMAIL, LEGAL_DOCS, LEGAL_NAV } from "./legal.ts";

describe("legal documents", () => {
  it("publishes privacy, terms, DPA, and subprocessors", () => {
    assert.deepEqual(
      LEGAL_NAV.map((item) => item.to),
      ["/privacy", "/terms", "/dpa", "/subprocessors"],
    );
    assert.equal(LEGAL_CONTACT_EMAIL, "privacy@evorove.com");
    for (const id of ["privacy", "terms", "dpa", "subprocessors"] as const) {
      assert.ok(LEGAL_DOCS[id].title.length > 0);
      assert.ok(LEGAL_DOCS[id].sections.length > 0);
    }
  });

  it("does not claim a conversion rate or that conversations train a model", () => {
    const privacy = flattenLegalDocument(LEGAL_DOCS.privacy);
    const terms = flattenLegalDocument(LEGAL_DOCS.terms);
    const dpa = flattenLegalDocument(LEGAL_DOCS.dpa);
    const all = `${privacy}\n${terms}\n${dpa}`;

    assert.match(privacy, /do not use your conversations to train a foundation model/i);
    assert.match(dpa, /will not use Customer Content to train, fine-tune, or develop a foundation model/i);
    assert.match(terms, /do not promise you a conversion rate/i);
    assert.doesNotMatch(all, /\b96%/);
    assert.doesNotMatch(all, /chatbot/i);
    assert.doesNotMatch(all, /cold lead/i);
  });

  it("lists the processors the product actually uses", () => {
    const text = flattenLegalDocument(LEGAL_DOCS.subprocessors);
    for (const name of ["Anthropic", "Railway", "Cloudflare", "Lemon Squeezy", "Twilio"]) {
      assert.match(text, new RegExp(name));
    }
  });

  it("treats the account holder as controller of end-customer data", () => {
    const dpa = flattenLegalDocument(LEGAL_DOCS.dpa);
    assert.match(dpa, /controller or .+business/i);
    assert.match(dpa, /service provider \/ processor/i);
  });
});
