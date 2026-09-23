/* THE DAILY SIGNAL — fixed, dependency-free reader. JSON is data, never markup. */
(() => {
  "use strict";
  const BASE = new URL("./", document.baseURI);
  const KINDS = { facebook: "Facebook", rss: "RSS", news: "News Search", web: "Web", other: "Other" };
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries(["main", "message", "message-title", "message-detail", "retry-latest", "edition-panel", "edition-number", "edition-date", "updated-time", "channel-status", "search-input", "section-filter", "kind-filter", "tag-filters", "tag-total", "topic-index", "stories", "results-count", "empty-results", "archive-list", "archive-count"].map((id) => [id, $(id)]));
  const CHANNELS = ["facebook", "chatgpt"];
  const state = { manifests: null, edition: null, controller: null, request: 0, tag: "" };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const str = (v) => typeof v === "string";
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  function keys(value, required, optional = []) {
    return obj(value) && required.every((k) => own(value, k)) && Object.keys(value).every((k) => required.includes(k) || optional.includes(k));
  }
  function day(value) {
    if (!str(value) || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function timestamp(value) {
    return str(value) && /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && day(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24;
  }
  const publication = (value) => value === "" || day(value) || timestamp(value);
  function externalURL(value) {
    if (!str(value) || !/^https?:\/\/[^/@\s]+(?:[/?#][^\s]*)?$/.test(value)) return null;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function imageURL(value) {
    if (!str(value)) return null;
    if (value.startsWith("https://")) return externalURL(value);
    if (/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(value)) return new URL(value, BASE).href;
    return null;
  }
  function validateManifest(m, channel) {
    const error = "The catalog JSON is invalid or incompatible with schema_version 1.";
    check(keys(m, ["schema_version", "current", "updated_at", "editions"]) && m.schema_version === 1 && day(m.current) && timestamp(m.updated_at) && Array.isArray(m.editions) && m.editions.length > 0, error);
    const dates = new Set();
    for (const e of m.editions) {
      check(keys(e, ["date", "path", "story_count", "is_demo"]) && day(e.date) && e.path === `data/${channel}/editions/${e.date}.json` && Number.isSafeInteger(e.story_count) && e.story_count >= 0 && typeof e.is_demo === "boolean" && !dates.has(e.date), error);
      dates.add(e.date);
    }
    check(dates.has(m.current), "The catalog current date has no matching edition.");
    return m;
  }
  function validateEdition(e, entry) {
    const error = "The edition JSON is invalid or does not match the catalog / edition schema.";
    check(keys(e, ["schema_version", "date", "generated_at", "is_demo", "stories"], ["edition_title", "edition_summary", "source_reports"]) && e.schema_version === 1 && day(e.date) && timestamp(e.generated_at) && typeof e.is_demo === "boolean" && (!own(e, "edition_title") || str(e.edition_title)) && (!own(e, "edition_summary") || str(e.edition_summary)) && Array.isArray(e.stories), error);
    check(e.date === entry.date && e.is_demo === entry.is_demo && e.stories.length === entry.story_count, error);
    if (own(e, "source_reports")) {
      const reports = e.source_reports;
      check(keys(reports, [], ["facebook", "configured_sources"]), error);
      for (const channel of ["facebook", "configured_sources"]) {
        if (!own(reports, channel)) continue;
        const report = reports[channel];
        check(keys(report, ["status", "completed_at", "captured", "included", "excluded", "notes"]) && ["complete", "limited"].includes(report.status) && timestamp(report.completed_at) && [report.captured, report.included, report.excluded].every((count) => Number.isInteger(count) && count >= 0) && Array.isArray(report.notes) && report.notes.every(str), error);
      }
    }
    const ids = new Set();
    for (const s of e.stories) {
      check(keys(s, ["id", "title", "summary", "section", "source_kind", "tags", "sources"], ["deck", "published_at", "image", "original_text"]) && str(s.id) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(s.id) && !ids.has(s.id) && str(s.title) && s.title.length > 0 && str(s.summary) && str(s.section) && str(s.source_kind) && own(KINDS, s.source_kind), error);
      ids.add(s.id);
      check((!own(s, "deck") || str(s.deck)) && (!own(s, "published_at") || publication(s.published_at)), error);
      check(!own(s, "original_text") || str(s.original_text), error);
      check(Array.isArray(s.tags) && s.tags.every((t) => str(t) && t.length > 0) && new Set(s.tags).size === s.tags.length && Array.isArray(s.sources), error);
      check(e.is_demo || s.sources.length > 0, error);
      for (const source of s.sources) {
        check(keys(source, ["name"], ["url", "published_at"]) && str(source.name) && source.name.length > 0 && (!own(source, "url") || source.url === "" || externalURL(source.url)) && (!own(source, "published_at") || publication(source.published_at)), error);
        check(e.is_demo || externalURL(source.url), "Published stories must retain a valid original-source URL.");
      }
      if (s.image !== undefined && s.image !== null) {
        check(keys(s.image, ["url", "alt"], ["credit"]) && imageURL(s.image.url) && str(s.image.alt) && s.image.alt.length > 0 && (!own(s.image, "credit") || str(s.image.credit)), error);
      }
    }
    return e;
  }
  async function fetchJSON(path, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    const url = new URL(path, BASE);
    url.searchParams.set("_", String(Date.now()));
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "omit", mode: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error(`Unable to fetch ${path} (HTTP ${response.status}).`);
      try { return await response.json(); }
      catch (error) { if (error.name === "AbortError") throw error; throw new Error(`${path} is not valid JSON.`); }
    } catch (error) {
      if (timedOut) throw new Error("The request timed out. Please retry the latest edition.");
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function formatDate(value) {
    if (day(value)) return value.replaceAll("-", "/");
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  }
  function timeNode(value) { const el = node("time", formatDate(value)); el.dateTime = value; return el; }
  function link(source) {
    const href = externalURL(source.url);
    if (!href) return node("span", `${source.name} · Original URL unavailable`, "source-note");
    const a = node("a", `${source.name} · View original ↗`, "source-link");
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", `${source.name}: view original (opens in a new tab)`);
    return a;
  }
  function renderChannelStatus(statuses) {
    const fragment = document.createDocumentFragment();
    for (const status of statuses) {
      const article = node("p", undefined, "channel-status-item");
      const label = status.channel === "facebook" ? "Facebook" : "ChatGPT";
      article.append(node("strong", `${label}: ${status.error ? "Read failed" : "Limited read"}. `));
      article.append(document.createTextNode(status.error || "This channel may be incomplete."));
      fragment.append(article);
    }
    ui["channel-status"].replaceChildren(fragment);
    ui["channel-status"].hidden = statuses.length === 0;
  }
  function renderStory(s) {
    const article = node("article", undefined, "story");
    article.id = `story-${s.channel}-${s.id}`;
    if (s === state.edition.stories[0]) article.classList.add("story--lead");
    const kicker = node("p", undefined, "story-kicker");
    kicker.append(node("span", s.section || "Uncategorized"));
    if (state.edition.is_demo) kicker.append(node("span", "SAMPLE / DEMO", "demo-stamp"));
    const title = node("h3", s.title); title.id = `title-${s.channel}-${s.id}`;
    article.setAttribute("aria-labelledby", title.id);
    article.append(kicker, title);
    if (s.deck) article.append(node("p", s.deck, "story-deck"));
    const meta = node("p", undefined, "story-meta");
    meta.append(node("span", KINDS[s.source_kind]));
    if (s.published_at) meta.append(timeNode(s.published_at));
    else meta.append(node("span", "Publication time unavailable"));
    article.append(meta);
    if (s.image) {
      const figure = node("figure", undefined, "news-photo");
      const frame = node("div", undefined, "photo-window");
      const image = node("img"); image.alt = s.image.alt; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { figure.hidden = true; }, { once: true });
      image.src = imageURL(s.image.url); frame.append(image); figure.append(frame);
      article.append(figure);
    }
    article.append(node("p", s.summary, "story-summary"));
    if (own(s, "original_text")) {
      const original = node("details", undefined, "story-original");
      original.append(node("summary", "View original text"));
      original.append(node("p", s.original_text, "original-text-content"));
      article.append(original);
    }
    if (s.tags.length) {
      const tags = node("p", undefined, "story-tags"); tags.setAttribute("aria-label", "Topic tags");
      for (const tag of s.tags) tags.append(node("span", `#${tag}`));
      article.append(tags);
    }
    const sources = node("div", undefined, "story-sources");
    if (s.sources.length > 1) {
      const details = node("details"); details.append(node("summary", `${s.sources.length} sources · Show sources`));
      const list = node("ul");
      for (const source of s.sources) { const item = node("li"); item.append(link(source)); if (source.published_at) item.append(timeNode(source.published_at)); list.append(item); }
      details.append(list); sources.append(details);
    } else if (s.sources.length === 1) {
      sources.append(link(s.sources[0]));
      if (s.sources[0].published_at) sources.append(timeNode(s.sources[0].published_at));
    } else sources.append(node("p", "DEMO layout sample · No news source", "source-note"));
    article.append(sources);
    return article;
  }
  const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("zh-Hant");
  function renderResults() {
    if (!state.edition) return;
    const terms = normalize(ui["search-input"].value.trim()).split(/\s+/).filter(Boolean);
    const section = ui["section-filter"].value;
    const kind = ui["kind-filter"].value;
    const filtered = state.edition.stories.filter((s) => {
      const text = normalize([s.title, s.deck || "", s.summary, ...s.tags, ...s.sources.map((source) => source.name)].join(" "));
      return (!section || s.section === section) && (!kind || s.source_kind === kind) && (!state.tag || s.tags.includes(state.tag)) && terms.every((term) => text.includes(term));
    });
    const fragment = document.createDocumentFragment();
    for (const story of filtered) fragment.append(renderStory(story));
    ui.stories.replaceChildren(fragment);
    ui["results-count"].textContent = `Showing ${filtered.length} / ${state.edition.stories.length}`;
    ui["empty-results"].hidden = filtered.length > 0;
    ui["empty-results"].textContent = state.edition.stories.length ? "No stories match the current filters. Adjust the search or clear the filters." : "No stories are available for this edition.";
    for (const button of ui["tag-filters"].querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.tag === state.tag));
  }
  function fillSelect(select, values, label, labels = null) {
    select.replaceChildren(new Option(label, ""));
    for (const value of values) select.add(new Option(labels ? labels[value] : value, value));
  }
  function resetFilters() { state.tag = ""; ui["search-input"].value = ""; ui["section-filter"].value = ""; ui["kind-filter"].value = ""; renderResults(); }
  function setupFilters() {
    const stories = state.edition.stories;
    fillSelect(ui["section-filter"], [...new Set(stories.map((s) => s.section).filter(Boolean))], "All sections");
    fillSelect(ui["kind-filter"], [...new Set(stories.map((s) => s.source_kind))], "All types", KINDS);
    const tags = [...new Set(stories.flatMap((s) => s.tags))];
    ui["topic-index"].hidden = tags.length === 0;
    ui["tag-total"].textContent = `(${tags.length})`;
    ui["tag-filters"].replaceChildren();
    for (const tag of ["", ...tags]) {
      const button = node("button", tag || "All topics"); button.type = "button"; button.dataset.tag = tag;
      button.addEventListener("click", () => { state.tag = tag; renderResults(); });
      ui["tag-filters"].append(button);
    }
    resetFilters();
  }
  function editionURL(date) {
    const url = new URL(window.location.href); url.hash = "";
    if (date === null) url.searchParams.delete("edition"); else url.searchParams.set("edition", date);
    return url;
  }
  function renderArchive() {
    if (!state.manifests) return;
    ui["archive-list"].replaceChildren();
    const dates = [...new Set(CHANNELS.flatMap((channel) => (state.manifests[channel]?.editions ?? []).map((entry) => entry.date)))].sort((a, b) => b.localeCompare(a));
    const latest = dates[0];
    for (const date of dates) {
      const entries = CHANNELS.map((channel) => state.manifests[channel]?.editions.find((entry) => entry.date === date)).filter(Boolean);
      const item = node("li"); const a = node("a", date);
      a.href = editionURL(date).href; a.dataset.edition = date;
      if (date === state.edition?.date) a.setAttribute("aria-current", "page");
      a.append(node("small", `${entries.reduce((total, entry) => total + entry.story_count, 0)} 則${entries.some((entry) => entry.is_demo) ? " · SAMPLE / DEMO" : ""}${date === latest ? " · Latest" : ""}`));
      a.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); openEdition(date, { historyMode: "push", focus: true });
      });
      item.append(a); ui["archive-list"].append(item);
    }
    ui["archive-count"].textContent = `/ ${dates.length} editions`;
  }
  function showMessage(title, detail, error = false) {
    ui.message.hidden = false;
    ui.message.setAttribute("role", error ? "alert" : "status");
    ui["message-title"].textContent = title;
    ui["message-detail"].textContent = detail;
    ui["retry-latest"].hidden = !error;
    if (error) ui.message.focus({ preventScroll: true });
  }
  function requestedDate() {
    const values = new URL(window.location.href).searchParams.getAll("edition");
    return values.length > 1 ? "invalid" : (values.length ? values[0] : null);
  }
  async function openEdition(date = null, { refresh = false, historyMode = "none", focus = false } = {}) {
    const request = ++state.request;
    state.controller?.abort(); state.controller = new AbortController();
    const signal = state.controller.signal;
    if (historyMode !== "none") {
      const url = editionURL(date);
      if (url.href !== window.location.href) history[historyMode === "push" ? "pushState" : "replaceState"]({}, "", url);
    }
    state.edition = null;
    ui["edition-panel"].hidden = true;
    ui.main.setAttribute("aria-busy", "true");
    ui["edition-number"].textContent = "NO. —";
    ui["edition-date"].textContent = "Loading edition"; ui["edition-date"].removeAttribute("datetime");
    ui["updated-time"].textContent = "—"; ui["updated-time"].removeAttribute("datetime");
    document.title = "THE DAILY SIGNAL";
    showMessage("Loading edition…", "Loading catalogs and edition content.");
    try {
      const loadCatalog = async (channel) => {
        try {
          const manifest = validateManifest(await fetchJSON(`data/${channel}/index.json`, signal), channel);
          return { manifest };
        } catch (error) {
          if (signal.aborted) throw error;
          return { error: error instanceof TypeError ? "Connection failed while loading the catalog." : error.message };
        }
      };
      if (!state.manifests || refresh) {
        const catalogs = await Promise.all(CHANNELS.map(loadCatalog));
        if (request !== state.request) return;
        state.manifests = Object.fromEntries(CHANNELS.map((channel, index) => [channel, catalogs[index].manifest]));
        state.catalogErrors = Object.fromEntries(CHANNELS.map((channel, index) => [channel, catalogs[index].error]));
      }
      renderArchive();
      const dates = CHANNELS.flatMap((channel) => (state.manifests[channel]?.editions ?? []).map((entry) => entry.date));
      const target = date === null ? dates.sort((a, b) => b.localeCompare(a))[0] : date;
      check(target, "No editions are available from either source catalog.");
      check(day(target), "The edition date in the URL is invalid. Use YYYY-MM-DD and select an edition from the archive.");
      const channelResults = await Promise.all(CHANNELS.map(async (channel) => {
        const entry = state.manifests[channel]?.editions.find((e) => e.date === target);
        if (!entry) return { channel, absent: true };
        try {
          const edition = validateEdition(await fetchJSON(entry.path, signal), entry);
          return { channel, edition };
        } catch (error) {
          if (signal.aborted) throw error;
          return { channel, error: error instanceof TypeError ? "Connection failed while loading this edition." : error.message };
        }
      }));
      if (request !== state.request) return;
      const available = channelResults.filter((result) => result.edition);
      check(available.length, `No channel content is available for ${target}.`);
      const editions = available.map(({ channel, edition }) => ({ channel, edition }));
      const edition = { date: target, generated_at: editions.map(({ edition: value }) => value.generated_at).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1), is_demo: editions.every(({ edition: value }) => value.is_demo), stories: editions.flatMap(({ channel, edition: value }) => value.stories.map((story) => ({ ...story, channel }))) };
      state.edition = edition;
      ui["edition-number"].textContent = `NO. ${edition.date.replaceAll("-", "")}`;
      ui["edition-date"].textContent = formatDate(edition.date); ui["edition-date"].dateTime = edition.date;
      ui["updated-time"].textContent = edition.generated_at ? formatDate(edition.generated_at) : "—";
      if (edition.generated_at) ui["updated-time"].dateTime = edition.generated_at; else ui["updated-time"].removeAttribute("datetime");
      const statuses = [];
      for (const result of channelResults) {
        if (result.error || state.catalogErrors?.[result.channel]) statuses.push({ channel: result.channel, error: result.error || state.catalogErrors[result.channel], notes: [] });
        if (result.edition) {
          const reports = result.edition.source_reports || {};
          const report = reports[result.channel] || reports[result.channel === "chatgpt" ? "configured_sources" : "facebook"];
          if (report?.status === "limited") statuses.push({ channel: result.channel, notes: report.notes });
        }
      }
      renderChannelStatus(statuses);
      setupFilters(); renderArchive();
      ui.message.hidden = true; ui["edition-panel"].hidden = false;
      document.title = `${edition.date}${edition.is_demo ? " SAMPLE / DEMO" : ""} · THE DAILY SIGNAL`;
      if (focus) ui["edition-date"].focus({ preventScroll: true });
    } catch (error) {
      if (request !== state.request || signal.aborted) return;
      showMessage("Edition unavailable", error instanceof TypeError ? "Connection failed while loading this edition. Check your network and retry." : error.message, true);
      ui["edition-date"].textContent = "Edition unavailable";
    } finally { if (request === state.request) ui.main.setAttribute("aria-busy", "false"); }
  }
  $("search-form").addEventListener("submit", (event) => { event.preventDefault(); renderResults(); });
  ui["search-input"].addEventListener("input", renderResults);
  ui["section-filter"].addEventListener("change", renderResults);
  ui["kind-filter"].addEventListener("change", renderResults);
  $("reset-filters").addEventListener("click", resetFilters);
  const latest = () => openEdition(null, { refresh: true, historyMode: "push", focus: true });
  ui["retry-latest"].addEventListener("click", latest);
  document.querySelectorAll(".latest-link").forEach((a) => a.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); latest();
  }));
  $("back-top").addEventListener("click", (event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "auto" }); document.querySelector(".masthead a").focus({ preventScroll: true }); });
  window.addEventListener("popstate", () => openEdition(requestedDate(), { refresh: true }));
  openEdition(requestedDate(), { refresh: true });
})();
