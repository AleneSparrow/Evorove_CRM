/** Public FAQ copy for the marketing homepage and the dedicated /faq route.
 * Kept in one place so the cabinet can link to the same answers without
 * duplicating (or drifting from) the homepage section. */
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Does this bring me new customers?",
    a: "No. Evorove works the inquiries you already get — from your website, your ads, your referrals. Finding new leads is a different problem and we don't claim to solve it.",
  },
  {
    q: "Does it take payment from my customer?",
    a: "No. It gets to a confirmed booking or an approved quote and hands you a prepared job. Collecting the money stays with you, through whatever you already use.",
  },
  {
    q: "What does setup actually look like?",
    a: "At signup you name your industry, describe what you do in a sentence, and list your services. That is the configuration. Nobody builds a version for your company, and there are no keyword lists to maintain — it understands what customers write in their own words.",
  },
  {
    q: "What if it doesn't understand someone?",
    a: "It asks again, in plain language, rather than guessing or dumping the person on you. After a few attempts it hands the conversation to a person.",
  },
  {
    q: "Can it say something that gets me in trouble?",
    a: "It can only reword content that already exists in your configuration. It has no mechanism to generate a price, a promise, or an opinion you did not write. Requests for advice or a judgment call are escalated to you, not answered.",
  },
  {
    q: "My business is nothing like a law firm. Will it work?",
    a: "The engine contains no industry-specific logic — not one branch, anywhere. It reads your own description of what you do. Law practices are simply the first industry we opened to customers, not what the product is built around.",
  },
  {
    q: "Where does it work?",
    a: "The United States today. Other English-speaking markets follow once address handling is ready for them — we would rather say that plainly than sell you something that mishandles your postcodes.",
  },
  {
    q: "Do you train AI on my customers' conversations?",
    a: "No. We do not use those conversations to train or fine-tune a foundation model. A model may rewrite a step the engine already chose. We keep logs and audits so the cycle is measurable. The Privacy Policy and DPA spell this out.",
  },
];
