/** Public legal copy for /privacy, /terms, /dpa, and /subprocessors.
 * Customer-facing English. Keep claims aligned with the product: we store
 * inquiry-to-deal records; we do not train a foundation model on them. */

export const LEGAL_CONTACT_EMAIL = "privacy@evorove.com";
export const LEGAL_UPDATED = "September 7, 2026";
export const LEGAL_SITE = "https://evorove.com";

export const LEGAL_NAV = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/dpa", label: "DPA" },
  { to: "/subprocessors", label: "Subprocessors" },
] as const;

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "note"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export type LegalSection = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocId = "privacy" | "terms" | "dpa" | "subprocessors";

export type LegalDoc = {
  id: LegalDocId;
  eyebrow: string;
  title: string;
  summary: string;
  sections: LegalSection[];
};

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  privacy: {
    id: "privacy",
    eyebrow: "Privacy Policy",
    title: "How Evorove handles information",
    summary:
      "This policy describes how the operator of Evorove (“Evorove,” “we,” “us”) collects, uses, and shares information when you visit evorove.com, create an account, or use the inquiry-to-deal engine. Paid subscriptions are billed by Lemon Squeezy as merchant of record. We do not sell personal information. We do not use your conversations to train a foundation model.",
    sections: [
      {
        id: "who",
        title: "1. Who this policy covers",
        blocks: [
          {
            type: "p",
            text: "It covers two groups, and the difference matters.",
          },
          {
            type: "ul",
            items: [
              "Account holders — the business that signs up for Evorove, and that business’s staff. You are our customer. We are the business collecting your account data.",
              "End customers — people who inquire with your business (website chat, SMS if you enable it, or another connected channel). For their personal information, you are the business that decides why it is collected. We process it to run the Service for you. Details are in the [[/dpa|Data Processing Addendum]].",
            ],
          },
        ],
      },
      {
        id: "operator",
        title: "2. Who we are",
        blocks: [
          {
            type: "p",
            text: "Evorove is the product at evorove.com. The Service is operated from outside the United States and offered to United States businesses. Hosting, the database, and most subprocessors run in the United States. Write to us at privacy@evorove.com.",
          },
        ],
      },
      {
        id: "collect",
        title: "3. Information we collect",
        blocks: [
          {
            type: "p",
            text: "Account and billing. Work email, password (stored hashed), name if you add one, authentication and two-factor settings, business configuration (Business DNA), and subscription status. Card and tax details for paid plans are collected by Lemon Squeezy, not stored in our application database.",
          },
          {
            type: "p",
            text: "Service records. Incoming inquiries, conversation messages, extracted facts (for example name, phone, email, ZIP, service requested), qualification answers, SMS consent flags, STOP/START/HELP handling, bookings, quotes, payment-request records that do not collect funds, audit events, and staff actions such as human takeover.",
          },
          {
            type: "p",
            text: "Technical data. IP address, user-agent, timestamps, and security logs needed to run, debug, and protect the Service. We do not run third-party advertising pixels or marketing analytics cookies on the public site.",
          },
        ],
      },
      {
        id: "use",
        title: "4. How we use information",
        blocks: [
          {
            type: "ul",
            items: [
              "Provide the Service: qualify the inquiry, choose the next allowed step, send approved wording, book or quote when your rules allow it, follow up, and hand off to a person.",
              "Secure the account: authentication, rate limits, abuse prevention, and audit trails.",
              "Bill the account through Lemon Squeezy.",
              "Improve the engine without training a model: logs, evals, prompt and policy review, and staff-reviewed shadow comparisons. That work uses operational records. It does not fine-tune or train a foundation model on your content.",
              "Comply with law and enforce the [[/terms|Terms of Service]].",
            ],
          },
        ],
      },
      {
        id: "ai",
        title: "5. AI processing — what we do and do not do",
        blocks: [
          {
            type: "p",
            text: "A language-model provider (currently Anthropic, with an optional OpenAI-compatible fallback) may receive bounded conversation text so it can classify language and rewrite a move the engine already chose. The model does not set prices, grant discounts, invent guarantees, or bypass your Business DNA. Server-side validation treats model output as untrusted.",
          },
          {
            type: "note",
            text: "We do not use Customer Content to train, fine-tune, or build a foundation model. We do not grant a provider the right to train their models on your content beyond what their API terms already state for API traffic. If we ever offer an optional fine-tune, it will require a separate written opt-in from the account holder.",
          },
        ],
      },
      {
        id: "end-customers",
        title: "6. End customers of your business",
        blocks: [
          {
            type: "p",
            text: "If you embed chat or connect SMS, people who contact you will send messages and contact details into Evorove because you asked us to run that conversation. You are responsible for telling them who is writing (including that a system may reply), for collecting any consent your channel requires, and for honoring their requests that the law puts on you. We will help you locate or delete their records in the Service when you ask, as described in the [[/dpa|DPA]].",
          },
        ],
      },
      {
        id: "sms",
        title: "7. SMS",
        blocks: [
          {
            type: "p",
            text: "SMS is optional and uses Twilio when you provision a number. We store consent and suppression so the engine does not text someone who said STOP. HELP and START are honored as US carriers expect. You must not use Evorove to send SMS without the consent the law requires for that message. We are not your TCPA counsel.",
          },
        ],
      },
      {
        id: "cookies",
        title: "8. Cookies and local storage",
        blocks: [
          {
            type: "p",
            text: "The staff app stores a session token and the active business id in the browser’s local storage so you stay signed in. That is strictly necessary to operate the account. We do not set advertising cookies. If that changes, this policy will say so before any non-essential cookie is used.",
          },
        ],
      },
      {
        id: "sharing",
        title: "9. Sharing",
        blocks: [
          {
            type: "p",
            text: "We share information with the companies listed on the [[/subprocessors|Subprocessors]] page, and only to provide the Service. We may share information if the law requires it, to protect the Service, or if we transfer the business (you would be notified if that happens). We do not sell personal information and we do not share it for cross-context behavioral advertising.",
          },
        ],
      },
      {
        id: "retention",
        title: "10. Retention",
        blocks: [
          {
            type: "p",
            text: "We keep account, conversation, and audit records for as long as the account needs the Service and for a limited period afterward so we can restore a workspace, resolve disputes, and meet legal duties. There is not yet a self-serve delete-everything control. Email privacy@evorove.com to request deletion of an account or of an end customer’s records. We will delete or anonymize what we can, except data we must keep for security, billing, or law.",
          },
        ],
      },
      {
        id: "rights",
        title: "11. Your rights (United States, including California)",
        blocks: [
          {
            type: "p",
            text: "If you are a US resident you may request access, correction, deletion, or a copy of personal information we hold about you as an account holder. California residents also have CPRA rights to know, delete, correct, and opt out of sale or sharing. We do not sell or share personal information as those words are used in CPRA. We will not discriminate against you for exercising these rights.",
          },
          {
            type: "p",
            text: "Send requests to privacy@evorove.com from the email on the account. We may need to verify it is you. If you are an end customer of a business that uses Evorove, contact that business first — they control the conversation. We will support them on the request.",
          },
        ],
      },
      {
        id: "children",
        title: "12. Children",
        blocks: [
          {
            type: "p",
            text: "The Service is for businesses, not for children under 18, and not directed at children under 13. If you believe we have collected information from a child, write to privacy@evorove.com and we will delete it.",
          },
        ],
      },
      {
        id: "transfers",
        title: "13. International transfers",
        blocks: [
          {
            type: "p",
            text: "The product market is the United States. Personal information is stored primarily in the United States. It may be accessed from the country where the operator works, and by subprocessors in the United States or other locations they disclose, in order to run the Service.",
          },
        ],
      },
      {
        id: "changes",
        title: "14. Changes",
        blocks: [
          {
            type: "p",
            text: "We will update this page when the practice changes. The date at the top is the current version. Material changes to how we use personal information will be posted here, and we will email the account address when the change is significant.",
          },
        ],
      },
      {
        id: "contact",
        title: "15. Contact",
        blocks: [
          {
            type: "p",
            text: "Privacy questions and requests: privacy@evorove.com. General product questions belong in the product, not in a legal inbox.",
          },
        ],
      },
    ],
  },

  terms: {
    id: "terms",
    eyebrow: "Terms of Service",
    title: "Terms of Service",
    summary:
      "These terms govern your use of Evorove. If you create an account, you agree to them. Paid plans are also subject to Lemon Squeezy’s merchant-of-record checkout terms. The Privacy Policy and Data Processing Addendum are part of this agreement.",
    sections: [
      {
        id: "agreement",
        title: "1. The agreement",
        blocks: [
          {
            type: "p",
            text: "“You” means the business that opens the account. You must be able to form a contract and must use the Service for that business, not as a consumer toy. If you do not agree, do not create an account.",
          },
        ],
      },
      {
        id: "service",
        title: "2. The Service",
        blocks: [
          {
            type: "p",
            text: "Evorove is an inquiry-to-deal engine. It carries an inbound lead through qualification, follow-up, and a booked job or accepted quote, using rules you configure as Business DNA. A language model may rephrase an already chosen step. It does not invent your prices, discounts, legal advice, or guarantees.",
          },
          {
            type: "ul",
            items: [
              "The Service does not generate new leads or run ads for you.",
              "The Service does not collect payment from your end customer. A payment request in the product is a record, not a charge.",
              "We do not promise you a conversion rate. Closing a qualified inquiry is the job the product is built to do; the percentage you see in your own account is not a guarantee we make to you.",
            ],
          },
        ],
      },
      {
        id: "accounts",
        title: "3. Accounts",
        blocks: [
          {
            type: "p",
            text: "You are responsible for the people you invite, for keeping credentials safe, and for activity on the account. Tell us promptly if you think the account was misused. We may suspend an account that looks compromised or that violates these terms.",
          },
        ],
      },
      {
        id: "dna",
        title: "4. Your configuration and content",
        blocks: [
          {
            type: "p",
            text: "You own your Business DNA, your staff data, and the conversation content your end customers send you. You grant us a limited license to host and process that content only to provide and secure the Service, as described in the [[/privacy|Privacy Policy]] and [[/dpa|DPA]]. You represent that you have the right to give us that content and that it does not violate the law or someone else’s rights.",
          },
        ],
      },
      {
        id: "messaging",
        title: "5. End customers and messaging",
        blocks: [
          {
            type: "p",
            text: "You are responsible for how you present the Service to people who contact you, including any required AI disclosure, “not legal advice” or similar notice in your industry, and consent for SMS, email, or other channels. If you enable SMS, you must have consent to text that person. Evorove honors STOP, START, and HELP on Twilio numbers it sends from; that is a control, not a substitute for your own compliance. We are not your lawyer, bar-ethics advisor, or TCPA counsel.",
          },
        ],
      },
      {
        id: "ai-limits",
        title: "6. AI limits",
        blocks: [
          {
            type: "p",
            text: "Model output is untrusted. The engine decides the allowed next step. You must not rely on the Service for legal, medical, financial, or other professional advice to your end customer. You must not prompt the Service to ignore your own rules, invent a discount, or impersonate a human when a disclosure is required. We may refuse or halt a conversation that looks like abuse, an emergency we cannot handle, or a request outside your configured services.",
          },
        ],
      },
      {
        id: "fees",
        title: "7. Fees and billing",
        blocks: [
          {
            type: "p",
            text: "Paid plans are charged by Lemon Squeezy, LLC as merchant of record. Their checkout terms, taxes, invoices, and refunds apply to the purchase. The product currently offers a short trial on paid plans when that offer is shown at checkout; trial length is controlled there, not by a promise in marketing copy. Fees are for the software Service. They are not a share of your end-customer revenue.",
          },
        ],
      },
      {
        id: "acceptable-use",
        title: "8. Acceptable use",
        blocks: [
          {
            type: "p",
            text: "You may not use Evorove to spam, to send messages without required consent, to collect or store illegal content, to probe or disrupt the Service, to resell access without a written agreement, or to try to make the model bypass Business DNA, grant unauthorized discounts, or produce professional advice the engine is built not to give.",
          },
        ],
      },
      {
        id: "confidentiality",
        title: "9. Confidentiality",
        blocks: [
          {
            type: "p",
            text: "Each party will keep the other’s non-public information confidential and use it only to perform this agreement, except information that is public, independently developed, or required to be disclosed by law.",
          },
        ],
      },
      {
        id: "disclaimers",
        title: "10. Disclaimers",
        blocks: [
          {
            type: "p",
            text: "The Service is provided “as is.” We do not warrant that every inquiry will become a booked job, that the model’s wording will always match your taste, or that the Service will be uninterrupted. To the fullest extent the law allows, we disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement.",
          },
        ],
      },
      {
        id: "liability",
        title: "11. Limitation of liability",
        blocks: [
          {
            type: "p",
            text: "To the fullest extent the law allows, Evorove is not liable for lost profits, lost leads, lost goodwill, or indirect, incidental, special, or consequential damages. Our total liability for claims arising out of the Service is limited to the fees you paid us for the Service in the three months before the claim (or, if you are on trial and have paid nothing, fifty US dollars). Some states do not allow certain limits; in those states the limit is the maximum the law allows.",
          },
        ],
      },
      {
        id: "indemnity",
        title: "12. Indemnity",
        blocks: [
          {
            type: "p",
            text: "You will defend and indemnify Evorove against claims that arise from your content, your Business DNA, your messages to end customers, your failure to obtain consent, or your misuse of the Service.",
          },
        ],
      },
      {
        id: "term",
        title: "13. Term and termination",
        blocks: [
          {
            type: "p",
            text: "You may stop using the Service at any time. We may suspend or close an account for non-payment, abuse, or material breach. After closure we will handle remaining personal information as described in the Privacy Policy. Sections that should survive (including 4, 6, 9–12, 14, and 15) remain in effect.",
          },
        ],
      },
      {
        id: "changes-terms",
        title: "14. Changes",
        blocks: [
          {
            type: "p",
            text: "We may update these terms. The date at the top is the current version. If a change is material we will post it on this page and email the account. Continued use after the effective date is acceptance of the updated terms.",
          },
        ],
      },
      {
        id: "law",
        title: "15. Governing law",
        blocks: [
          {
            type: "p",
            text: "The Service is offered to United States businesses. These terms are governed by the laws of the State of California, without regard to conflict-of-law rules, except that Lemon Squeezy’s terms govern the payment transaction. If a court would not honor that choice, the law of the place that must apply will apply, and the rest of these terms still stand.",
          },
        ],
      },
      {
        id: "contact-terms",
        title: "16. Contact",
        blocks: [
          {
            type: "p",
            text: "Legal notices: privacy@evorove.com.",
          },
        ],
      },
    ],
  },

  dpa: {
    id: "dpa",
    eyebrow: "Data Processing Addendum",
    title: "Data Processing Addendum",
    summary:
      "This DPA is part of the Terms of Service. It applies when Evorove processes personal information of your end customers (and of your staff, where we act on your instructions) in order to provide the Service. It is written for US businesses. It is not a HIPAA BAA and not a UK/EU SCC pack.",
    sections: [
      {
        id: "roles",
        title: "1. Roles",
        blocks: [
          {
            type: "ul",
            items: [
              "You (the account holder) are the business that determines the purposes of processing end-customer personal information — in US privacy-law language, you are the controller or “business.”",
              "Evorove is the service provider / processor. We process that information only to provide the Service and as this DPA allows.",
              "Account data about you as our customer (your email, billing identity, how you use the product) is handled under the [[/privacy|Privacy Policy]], where we are the business collecting it.",
            ],
          },
        ],
      },
      {
        id: "scope",
        title: "2. Scope of processing",
        blocks: [
          {
            type: "p",
            text: "Subject matter: hosting and running inquiry-to-deal conversations for your business. Duration: the term of your account plus the short retention window in the Privacy Policy. Nature: storage, structured extraction, routing, messaging, audit, and constrained language-model calls. Types of data: identifiers and contact details the end customer or you supply, message content, location as ZIP when collected, service and qualification answers, SMS consent and suppression, booking and quote records. Data subjects: your end customers and, as needed, your staff users.",
          },
        ],
      },
      {
        id: "instructions",
        title: "3. Instructions",
        blocks: [
          {
            type: "p",
            text: "We will process Customer Content only: (a) to provide, secure, and support the Service; (b) as this DPA, the Terms, and the Privacy Policy describe; (c) as you instruct through the product (for example Business DNA, takeover, and channel settings); and (d) as US law requires. We will not sell Customer Content or use it for cross-context behavioral advertising.",
          },
        ],
      },
      {
        id: "ai-dpa",
        title: "4. AI subprocessors and model training",
        blocks: [
          {
            type: "p",
            text: "We may send bounded message text to a language-model API so the Service can classify language and phrase an already approved move. Those providers are subprocessors.",
          },
          {
            type: "note",
            text: "We will not use Customer Content to train, fine-tune, or develop a foundation model, and we will not allow a subprocessor to do so for our benefit, except as their standard API terms already apply to API traffic. Improvement of the deterministic engine (evals, policy, prompts, staff-reviewed shadow results) is not model training. A future fine-tune, if any, requires your separate written opt-in and will not mix your content with another customer’s.",
          },
        ],
      },
      {
        id: "confidentiality-dpa",
        title: "5. Confidentiality",
        blocks: [
          {
            type: "p",
            text: "People who can access Customer Content are under a confidentiality duty. Access is limited to providing the Service, security, and support.",
          },
        ],
      },
      {
        id: "security",
        title: "6. Security",
        blocks: [
          {
            type: "p",
            text: "We use tenant-scoped records, hashed session tokens, password hashing, optional two-factor authentication, redaction of phone and email patterns in some model prompts, webhook signature checks where a provider supplies them, and audit events for state changes. No internet service is perfectly secure. You must also protect staff accounts and the chat snippet on your site.",
          },
        ],
      },
      {
        id: "subprocessors-dpa",
        title: "7. Subprocessors",
        blocks: [
          {
            type: "p",
            text: "You authorize us to use the subprocessors listed at [[/subprocessors|evorove.com/subprocessors]]. We will post new subprocessors on that page before they process Customer Content in production. If you object on reasonable privacy grounds within 15 days, we will work in good faith on an alternative; if we cannot, either party may stop the Service for that account.",
          },
        ],
      },
      {
        id: "assistance",
        title: "8. Assistance with requests",
        blocks: [
          {
            type: "p",
            text: "If an end customer asks us for access or deletion, we will direct them to you when we can tell who the controller is. If you ask us to locate, correct, or delete an end customer’s records in the Service, we will do so as the product allows, and by hand via privacy@evorove.com until a self-serve tool exists, unless the law requires us to keep a copy.",
          },
        ],
      },
      {
        id: "breach",
        title: "9. Security incidents",
        blocks: [
          {
            type: "p",
            text: "If we confirm unauthorized access to Customer Content on our systems, we will notify you without unreasonable delay, and in any event as soon as practicable, with the facts we know: what happened, what data, and what we are doing. We will not admit fault in that notice beyond the facts.",
          },
        ],
      },
      {
        id: "deletion",
        title: "10. Return and deletion",
        blocks: [
          {
            type: "p",
            text: "When the account ends, you may request export of Customer Content we can reasonably export. After that we will delete or anonymize Customer Content within 60 days, except backups that rotate out later and records we must keep for law, billing disputes, or security. SMS suppression lists may be kept so we do not text a person who said STOP.",
          },
        ],
      },
      {
        id: "audit",
        title: "11. Oversight",
        blocks: [
          {
            type: "p",
            text: "Upon written request no more than once per year, we will provide a reasonable summary of the security measures that apply to the Service. Formal on-site audit is not part of the standard plan.",
          },
        ],
      },
      {
        id: "term-dpa",
        title: "12. Term",
        blocks: [
          {
            type: "p",
            text: "This DPA lasts as long as we process Customer Content for you. If it conflicts with the Terms on processing of Customer Content, this DPA controls. California law governs, as in the Terms.",
          },
        ],
      },
    ],
  },

  subprocessors: {
    id: "subprocessors",
    eyebrow: "Subprocessors",
    title: "Subprocessors",
    summary:
      "These companies may process personal information so we can provide Evorove. The list is for account holders and is incorporated into the DPA. Marketing tools we use to post on our own social accounts are not subprocessors of your end-customer conversations.",
    sections: [
      {
        id: "list",
        title: "Current subprocessors",
        blocks: [
          {
            type: "table",
            headers: ["Company", "What they do", "Where"],
            rows: [
              ["Anthropic", "Language-model API for constrained analysis and wording", "United States"],
              [
                "OpenAI or another OpenAI-compatible API (optional)",
                "Fallback language-model API when configured",
                "United States or the region that provider discloses",
              ],
              ["Railway", "Application hosting and PostgreSQL database", "United States"],
              ["Cloudflare", "Frontend hosting, CDN, and DNS for evorove.com", "Global edge; US configuration"],
              ["Lemon Squeezy, LLC", "Merchant of record: checkout, tax, invoices, payouts", "United States"],
              ["Twilio Inc.", "Optional SMS numbers and message delivery", "United States"],
            ],
          },
          {
            type: "p",
            text: "A provider appears here only if it can receive personal information while performing that job. If you never enable SMS, Twilio does not process your end-customer messages. If a language-model fallback is not configured, that second API is not used.",
          },
        ],
      },
      {
        id: "changes-sub",
        title: "Changes",
        blocks: [
          {
            type: "p",
            text: "We will update this page before a new subprocessor processes Customer Content in production. Questions: privacy@evorove.com. Related documents: [[/privacy|Privacy Policy]], [[/terms|Terms of Service]], [[/dpa|DPA]].",
          },
        ],
      },
    ],
  },
};

export function flattenLegalDocument(doc: LegalDoc): string {
  const fromBlock = (block: LegalBlock): string[] => {
    if (block.type === "p" || block.type === "note") return [block.text];
    if (block.type === "ul") return block.items;
    return [block.headers.join(" "), ...block.rows.map((row) => row.join(" "))];
  };
  return [
    doc.title,
    doc.summary,
    ...doc.sections.flatMap((section) => [section.title, ...section.blocks.flatMap(fromBlock)]),
  ].join("\n");
}
