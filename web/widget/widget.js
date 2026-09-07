(function () {
  "use strict";

  const script = document.currentScript || document.querySelector("script[src*='widget.js'][data-business-id]");
  if (!script) return;
  const businessId = script.dataset.businessId;
  if (!businessId) {
    console.error("AI Process Chat: data-business-id is required");
    return;
  }

  const scriptUrl = new URL(script.src, window.location.href);
  const apiBase = (script.dataset.apiBase || scriptUrl.origin).replace(/\/$/, "");
  const storageKey = `ai-process-chat:${apiBase}:${businessId}`;
  const pendingKey = `${storageKey}:pending-create`;
  const endpoint = `${apiBase}/api/v1/public/businesses/${encodeURIComponent(businessId)}`;
  let conversationToken = window.localStorage.getItem(storageKey);
  let pendingCreate = window.sessionStorage.getItem(pendingKey);
  let config = null;
  let busy = false;

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = `${scriptUrl.origin}/widget/widget.css`;
  document.head.append(stylesheet);

  const root = document.createElement("section");
  root.className = "aibp-chat";
  if (script.dataset.theme === "dark") root.classList.add("aibp-chat--dark");
  root.setAttribute("aria-label", "Business chat");

  function torusMark(className) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const ring = document.createElementNS(namespace, "circle");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "7.2");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "currentColor");
    ring.setAttribute("stroke-width", "3.2");
    svg.append(ring);
    const hub = document.createElementNS(namespace, "circle");
    hub.setAttribute("cx", "12");
    hub.setAttribute("cy", "12");
    hub.setAttribute("r", "2.2");
    hub.setAttribute("fill", "currentColor");
    svg.append(hub);
    const trail = document.createElementNS(namespace, "path");
    trail.setAttribute("d", "M20.6 8.8 A9 9 0 0 1 21.4 13.2");
    trail.setAttribute("fill", "none");
    trail.setAttribute("stroke", "currentColor");
    trail.setAttribute("stroke-width", "1.6");
    trail.setAttribute("stroke-linecap", "round");
    trail.setAttribute("opacity", "0.45");
    svg.append(trail);
    return svg;
  }

  const peek = document.createElement("p");
  peek.className = "aibp-chat__peek";
  peek.hidden = true;

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "aibp-chat__launcher";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.append(torusMark("aibp-chat__launcher-icon"));
  const launcherDot = document.createElement("span");
  launcherDot.className = "aibp-chat__launcher-dot";
  launcherDot.setAttribute("aria-hidden", "true");
  launcher.append(launcherDot);
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", "aibp-chat-panel");

  const panel = document.createElement("div");
  panel.id = "aibp-chat-panel";
  panel.className = "aibp-chat__panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  // A role="dialog" with no accessible name is announced as just "dialog".
  // Replaced with the business name once /chat-config resolves.
  panel.setAttribute("aria-label", "Chat");

  const header = document.createElement("header");
  header.className = "aibp-chat__header";
  const titleRow = document.createElement("div");
  titleRow.className = "aibp-chat__title-row";
  const identity = document.createElement("div");
  identity.className = "aibp-chat__identity";
  const brandMark = document.createElement("span");
  brandMark.className = "aibp-chat__brand-mark";
  brandMark.append(torusMark("aibp-chat__brand-mark-icon"));
  const titleCopy = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "Chat";
  const subtitle = document.createElement("p");
  subtitle.className = "aibp-chat__header-subtitle";
  subtitle.textContent = "AI assistant";
  titleCopy.append(title, subtitle);
  identity.append(brandMark, titleCopy);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "aibp-chat__close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close chat");
  titleRow.append(identity, close);
  // Persistent AI-disclosure badge -- stays visible in the header for the
  // entire session, not just a one-time greeting line that scrolls away.
  // Populated from Business DNA (chat_widget.ai_disclosure_text); hidden
  // entirely when a business hasn't configured one.
  const disclosureBadge = document.createElement("p");
  disclosureBadge.className = "aibp-chat__disclosure";
  disclosureBadge.hidden = true;
  header.append(titleRow, disclosureBadge);

  const history = document.createElement("div");
  history.className = "aibp-chat__history";
  history.setAttribute("role", "log");
  history.setAttribute("aria-live", "polite");
  history.setAttribute("aria-relevant", "additions");

  // Clickable slot-picker: rendered whenever the backend has an active,
  // unexpired slot proposal for this conversation (see /commercial's
  // proposed_slots). Clicking a button sends its 1-based option number as
  // an ordinary chat message -- DeterministicSlotPreferenceInterpreter
  // already accepts a bare "1"/"2"/"3" reply, so no new backend contract is
  // needed beyond exposing the slot list itself.
  const slotOptions = document.createElement("div");
  slotOptions.className = "aibp-chat__slots";
  slotOptions.hidden = true;
  slotOptions.setAttribute("aria-label", "Available times");

  const status = document.createElement("p");
  status.className = "aibp-chat__status";
  status.setAttribute("role", "status");

  // Explicit, deliberate opt-in for proactive follow-up SMS -- NEVER
  // inferred from anything the customer types (see Lead.sms_consent /
  // universal-sales-cycle-model.md section 8). Unchecked by default;
  // persisted per-browser the same way conversationToken already is, so a
  // returning visitor in the same conversation doesn't have to re-tick it
  // every time they reopen the widget. Reply STOP on the Twilio number is
  // honored in src/api/routes/sms.py. The label text below is still a
  // placeholder shape (informational, not marketing) -- NOT reviewed by a
  // lawyer; see the delivery notes for why this needs legal review per-state
  // before relying on it.
  const consentKey = `${storageKey}:sms-consent`;
  let smsConsent = window.localStorage.getItem(consentKey) === "true";
  const consentRow = document.createElement("label");
  consentRow.className = "aibp-chat__consent";
  const consentCheckbox = document.createElement("input");
  consentCheckbox.type = "checkbox";
  consentCheckbox.id = "aibp-chat-sms-consent";
  consentCheckbox.checked = smsConsent;
  consentCheckbox.addEventListener("change", function () {
    smsConsent = consentCheckbox.checked;
    window.localStorage.setItem(consentKey, String(smsConsent));
  });
  const consentText = document.createElement("span");
  consentText.textContent = "It's okay to text me updates about my request (reply STOP to opt out).";
  consentRow.append(consentCheckbox, consentText);

  const form = document.createElement("form");
  form.className = "aibp-chat__form";
  const label = document.createElement("label");
  label.className = "aibp-chat__label";
  label.htmlFor = "aibp-chat-input";
  label.textContent = "Message";
  const input = document.createElement("textarea");
  input.id = "aibp-chat-input";
  input.rows = 2;
  input.maxLength = 2000;
  input.required = true;
  input.placeholder = "Type your message";
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";
  form.append(label, input, send);
  panel.append(header, history, slotOptions, status, consentRow, form);
  root.append(peek, launcher, panel);
  document.body.append(root);

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    send.disabled = value;
    slotOptions.querySelectorAll("button").forEach((button) => { button.disabled = value; });
    history.querySelectorAll(".aibp-chat__service-button").forEach((button) => { button.disabled = value; });
  }

  // Animated "typing" bubble instead of a text status line -- shown in the
  // message history itself (where a reply is about to appear) rather than a
  // caption easy to miss below the input. Only one instance ever exists;
  // renderConversation()'s history.replaceChildren() removes it implicitly
  // whenever a real response lands, so hideTyping() just needs to null out
  // the stale reference rather than guarantee removal itself.
  let typingBubble = null;
  function showTyping() {
    if (typingBubble) return;
    typingBubble = document.createElement("div");
    typingBubble.className = "aibp-chat__message aibp-chat__message--assistant aibp-chat__typing";
    typingBubble.setAttribute("aria-label", "Assistant is typing");
    for (let index = 0; index < 3; index += 1) {
      typingBubble.append(document.createElement("span"));
    }
    history.append(typingBubble);
    history.scrollTop = history.scrollHeight;
  }
  function hideTyping() {
    if (typingBubble) {
      typingBubble.remove();
      typingBubble = null;
    }
  }

  function showError(message) {
    status.textContent = message;
    status.classList.add("aibp-chat__status--error");
  }

  function appendMessage(role, text, createdAt) {
    const normalizedRole = ["assistant", "customer", "human", "system"].includes(role) ? role : "assistant";
    const row = document.createElement("div");
    row.className = `aibp-chat__row aibp-chat__row--${normalizedRole}`;
    const wrap = document.createElement("div");
    wrap.className = "aibp-chat__bubble-wrap";
    if (normalizedRole === "assistant" || normalizedRole === "human") {
      const avatar = document.createElement("span");
      avatar.className = `aibp-chat__avatar aibp-chat__avatar--${normalizedRole}`;
      avatar.textContent = normalizedRole === "human" ? "TEAM" : "AI";
      wrap.append(avatar);
    }
    const message = document.createElement("p");
    message.className = `aibp-chat__message aibp-chat__message--${normalizedRole}`;
    message.textContent = text;
    wrap.append(message);
    row.append(wrap);
    if (createdAt && normalizedRole !== "system") {
      const meta = document.createElement("span");
      meta.className = "aibp-chat__message-meta";
      const timestamp = new Date(createdAt);
      meta.textContent = Number.isNaN(timestamp.valueOf())
        ? ""
        : timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      row.append(meta);
    }
    history.append(row);
    history.scrollTop = history.scrollHeight;
    return row;
  }

  // Quick-reply service chips: shown once, right under the opening welcome
  // message, so a first-time visitor can tap what they need instead of
  // typing it out. A tap just sends the service's own name as an ordinary
  // chat message (same trick as the slot-picker buttons) -- the AI intent
  // extractor already resolves free text against these same catalog
  // id/name/aliases, so this needs zero new interpretation logic. They
  // live inside `history` (not a persistent bar like slotOptions) because
  // they're a one-time opening move, not a recurring prompt: once any
  // message exists, renderConversation()'s replaceChildren() drops them
  // for good, the same way the welcome message itself scrolls away.
  function appendServiceOptions(services) {
    if (!services || !services.length) return;
    const row = document.createElement("div");
    row.className = "aibp-chat__services";
    row.setAttribute("aria-label", "Quick options");
    services.forEach(function (service) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "aibp-chat__service-button";
      button.textContent = service.name;
      button.addEventListener("click", function () {
        submitMessage(service.name);
      });
      row.append(button);
    });
    history.append(row);
    history.scrollTop = history.scrollHeight;
  }

  function renderConversation(data) {
    history.replaceChildren();
    if (!data.messages.length && config) {
      appendMessage("assistant", config.welcome_message);
      appendServiceOptions(config.services);
    }
    data.messages.forEach((message) => appendMessage(message.role, message.text, message.created_at));
    if (data.requires_human) status.textContent = "A team member will review this conversation.";
  }

  function formatSlotLabel(slot) {
    try {
      // Hardcoded, not the visitor's browser locale (`undefined` here would pick
      // that up via Intl.DateTimeFormat's default-locale behavior) -- this product
      // is 100% US-market, and a non-English browser locale (e.g. Russian) was
      // rendering weekday/month names in that language while the rest of the
      // dialogue stayed English, a real user-facing inconsistency found during
      // live QA (see claude/booking-milestone-and-research.md section 11).
      return new Intl.DateTimeFormat("en-US", {
        timeZone: slot.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(slot.start_at));
    } catch (error) {
      return slot.start_at;
    }
  }

  function renderSlotOptions(slots) {
    slotOptions.replaceChildren();
    if (!slots || !slots.length) {
      slotOptions.hidden = true;
      return;
    }
    slots.forEach(function (slot) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "aibp-chat__slot-button";
      button.textContent = formatSlotLabel(slot);
      button.addEventListener("click", function () {
        submitMessage(String(slot.option), { focusInput: false });
      });
      slotOptions.append(button);
    });
    slotOptions.hidden = false;
  }

  async function refreshCommercial() {
    if (!conversationToken) {
      renderSlotOptions([]);
      return;
    }
    try {
      const data = await request(`/conversations/${encodeURIComponent(conversationToken)}/commercial`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      renderSlotOptions(data.proposed_slots);
    } catch (error) {
      // Non-fatal -- the conversation itself already rendered successfully;
      // losing the slot buttons just means the customer types "1"/"2"/"3"
      // instead of clicking, same as before this feature existed.
      renderSlotOptions([]);
    }
  }

  function messageId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function conversationTokenValue() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function") {
      throw new Error("This browser cannot create a secure chat session.");
    }
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function request(path, options) {
    const response = await window.fetch(`${endpoint}${path}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // A 5xx is our problem, not the customer's, and its text describes our
      // infrastructure. Showing it verbatim is what put "The configured AI
      // provider is unavailable" in front of a real visitor on 2026-08-23,
      // on a law firm's own website. Server-side failures always get a plain
      // human sentence; only 4xx (message too long, rate limited, session
      // expired) still shows the server's wording, because those tell the
      // customer something they can actually act on.
      if (response.status >= 500) {
        throw new Error(
          "We're having trouble sending that right now. Please try again in a moment, or contact us directly."
        );
      }
      const message = data && data.error && data.error.message;
      throw new Error(message || "Chat request failed. Please try again.");
    }
    return data;
  }

  function customerTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (error) {
      return null;
    }
  }

  async function restore() {
    if (!conversationToken) {
      history.replaceChildren();
      if (config) {
        appendMessage("assistant", config.welcome_message);
        appendServiceOptions(config.services);
      }
      renderSlotOptions([]);
      return;
    }
    try {
      const data = await request(`/conversations/${encodeURIComponent(conversationToken)}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      renderConversation(data);
      await refreshCommercial();
      window.sessionStorage.removeItem(pendingKey);
      pendingCreate = null;
    } catch (error) {
      if (pendingCreate) {
        try {
          const payload = JSON.parse(pendingCreate);
          const data = await request("/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          renderConversation(data);
          await refreshCommercial();
          window.sessionStorage.removeItem(pendingKey);
          pendingCreate = null;
          return;
        } catch (retryError) {
          showError(retryError instanceof Error ? retryError.message : "Conversation could not be restored.");
          return;
        }
      }
      window.localStorage.removeItem(storageKey);
      conversationToken = null;
      showError(error instanceof Error ? error.message : "Conversation could not be restored.");
    }
  }

  async function sendMessage(text) {
    if (pendingCreate) {
      const retried = await request("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pendingCreate
      });
      window.sessionStorage.removeItem(pendingKey);
      pendingCreate = null;
      renderConversation(retried);
      return;
    }
    const message = { message: text, external_message_id: messageId(), sms_consent: smsConsent };
    let data;
    if (conversationToken) {
      data = await request(`/conversations/${encodeURIComponent(conversationToken)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
      });
    } else {
      conversationToken = conversationTokenValue();
      window.localStorage.setItem(storageKey, conversationToken);
      const createPayload = { ...message, conversation_token: conversationToken };
      const timezone = customerTimezone();
      if (timezone) createPayload.customer_timezone = timezone;
      pendingCreate = JSON.stringify(createPayload);
      window.sessionStorage.setItem(pendingKey, pendingCreate);
      data = await request("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: pendingCreate
      });
      window.sessionStorage.removeItem(pendingKey);
      pendingCreate = null;
    }
    renderConversation(data);
  }

  launcher.addEventListener("click", async function () {
    // Closing from the launcher used to skip the close handler, so the peek
    // bubble never came back and the label stayed "Open chat" -- the two ways
    // out of the panel behaved differently. Both go through closePanel now.
    if (!panel.hidden) {
      closePanel();
      return;
    }
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    launcher.setAttribute("aria-label", "Close chat");
    peek.hidden = true;
    await restore();
    input.focus();
  });
  function closePanel() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open chat");
    peek.hidden = !config;
    launcher.focus();
  }
  close.addEventListener("click", closePanel);
  // Escape must dismiss a role="dialog" -- without it a keyboard user has to
  // tab to the close button to get out of the chat.
  panel.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel();
    }
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  async function submitMessage(text, options) {
    const focusInput = !options || options.focusInput !== false;
    if (!text || busy) return;
    status.classList.remove("aibp-chat__status--error");
    setBusy(true);
    // Optimistic echo + typing bubble: a real reply overwrites both via
    // renderConversation()'s history.replaceChildren(), so nothing needs
    // reconciling on the success path. On failure the echo is retracted
    // (it may not have actually reached the business) while the typed text
    // stays in the input for a retry.
    const optimistic = appendMessage("customer", text, new Date().toISOString());
    showTyping();
    try {
      await sendMessage(text);
      input.value = "";
      await refreshCommercial();
    } catch (error) {
      optimistic.remove();
      showError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      hideTyping();
      setBusy(false);
      if (focusInput) input.focus();
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitMessage(input.value.trim());
  });

  request("/chat-config", { method: "GET", headers: { Accept: "application/json" } })
    .then(function (value) {
      config = value;
      title.textContent = value.chat_title;
      panel.setAttribute("aria-label", value.chat_title);
      // chat_title is already a full phrase ("Chat with Acme Law"), so
      // prefixing it produced "Ask Chat with Acme Law" on production.
      // Use it verbatim -- it reads correctly whether the owner configured
      // a phrase or a bare business name.
      peek.textContent = value.chat_title;
      peek.hidden = false;
      launcher.hidden = !value.enabled;
      if (value.ai_disclosure_text) {
        disclosureBadge.textContent = value.ai_disclosure_text;
        disclosureBadge.hidden = false;
      }
    })
    .catch(function () {
      launcher.hidden = true;
    });
}());
