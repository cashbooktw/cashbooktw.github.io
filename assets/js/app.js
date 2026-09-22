/* THE DAILY SIGNAL — fixed, dependency-free reader. JSON is data, never markup. */
(() => {
  "use strict";
  const BASE = new URL("./", document.baseURI);
  const KINDS = { facebook: "Facebook", rss: "RSS", news: "新聞搜尋", web: "網頁", other: "其他" };
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries(["main", "message", "message-title", "message-detail", "retry-latest", "edition-panel", "demo-notice", "edition-number", "edition-date", "updated-time", "edition-title", "edition-summary", "search-input", "section-filter", "kind-filter", "tag-filters", "tag-total", "topic-index", "stories", "results-count", "empty-results", "archive-list", "archive-count"].map((id) => [id, $(id)]));
  const state = { manifest: null, edition: null, controller: null, request: 0, tag: "" };
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
  function validateManifest(m) {
    const error = "目錄 JSON 格式不正確，或與 schema_version 1 不相容。";
    check(keys(m, ["schema_version", "current", "updated_at", "editions"]) && m.schema_version === 1 && day(m.current) && timestamp(m.updated_at) && Array.isArray(m.editions) && m.editions.length > 0, error);
    const dates = new Set();
    for (const e of m.editions) {
      check(keys(e, ["date", "path", "story_count", "is_demo"]) && day(e.date) && e.path === `data/editions/${e.date}.json` && Number.isSafeInteger(e.story_count) && e.story_count >= 0 && typeof e.is_demo === "boolean" && !dates.has(e.date), error);
      dates.add(e.date);
    }
    check(dates.has(m.current), "目錄 current 沒有對應期數。");
    return m;
  }
  function validateEdition(e, entry) {
    const error = "本期 JSON 格式不正確，或與目錄／edition schema 不一致。";
    check(keys(e, ["schema_version", "date", "generated_at", "is_demo", "edition_title", "edition_summary", "stories"]) && e.schema_version === 1 && day(e.date) && timestamp(e.generated_at) && typeof e.is_demo === "boolean" && str(e.edition_title) && str(e.edition_summary) && Array.isArray(e.stories), error);
    check(e.date === entry.date && e.is_demo === entry.is_demo && e.stories.length === entry.story_count, error);
    const ids = new Set();
    for (const s of e.stories) {
      check(keys(s, ["id", "title", "summary", "section", "source_kind", "tags", "sources"], ["deck", "published_at", "image"]) && str(s.id) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(s.id) && !ids.has(s.id) && str(s.title) && s.title.length > 0 && str(s.summary) && str(s.section) && str(s.source_kind) && own(KINDS, s.source_kind), error);
      ids.add(s.id);
      check((!own(s, "deck") || str(s.deck)) && (!own(s, "published_at") || publication(s.published_at)), error);
      check(Array.isArray(s.tags) && s.tags.every((t) => str(t) && t.length > 0) && new Set(s.tags).size === s.tags.length && Array.isArray(s.sources), error);
      check(e.is_demo || s.sources.length > 0, error);
      for (const source of s.sources) {
        check(keys(source, ["name"], ["url", "published_at"]) && str(source.name) && source.name.length > 0 && (!own(source, "url") || source.url === "" || externalURL(source.url)) && (!own(source, "published_at") || publication(source.published_at)), error);
        check(e.is_demo || externalURL(source.url), "正式新聞必須保留有效的原始來源 URL。");
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
      if (!response.ok) throw new Error(`無法取得 ${path}（HTTP ${response.status}）。`);
      try { return await response.json(); }
      catch (error) { if (error.name === "AbortError") throw error; throw new Error(`${path} 不是有效的 JSON。`); }
    } catch (error) {
      if (timedOut) throw new Error("調閱逾時，請稍後重試最新一期。");
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
    if (day(value)) return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${value}T00:00:00+08:00`));
    return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  }
  function timeNode(value) { const el = node("time", formatDate(value)); el.dateTime = value; return el; }
  function link(source) {
    const href = externalURL(source.url);
    if (!href) return node("span", `${source.name} · 未提供原文網址`, "source-note");
    const a = node("a", `${source.name} · 查看原文 ↗`, "source-link");
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", `${source.name}：查看原文（另開視窗）`);
    return a;
  }
  function renderStory(s) {
    const article = node("article", undefined, "story");
    article.id = `story-${s.id}`;
    if (s.id === state.edition.stories[0].id) article.classList.add("story--lead");
    const kicker = node("p", undefined, "story-kicker");
    kicker.append(node("span", s.section || "未分類"));
    if (state.edition.is_demo) kicker.append(node("span", "SAMPLE / DEMO", "demo-stamp"));
    const title = node("h3", s.title); title.id = `title-${s.id}`;
    article.setAttribute("aria-labelledby", title.id);
    article.append(kicker, title);
    if (s.deck) article.append(node("p", s.deck, "story-deck"));
    const meta = node("p", undefined, "story-meta");
    meta.append(node("span", KINDS[s.source_kind]));
    if (s.published_at) meta.append(timeNode(s.published_at));
    else meta.append(node("span", "發布時間未提供"));
    article.append(meta);
    if (s.image) {
      const figure = node("figure", undefined, "news-photo");
      const frame = node("div", undefined, "photo-window");
      const image = node("img"); image.alt = s.image.alt; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { figure.hidden = true; }, { once: true });
      image.src = imageURL(s.image.url); frame.append(image); figure.append(frame);
      if (s.image.credit) figure.append(node("figcaption", s.image.credit));
      article.append(figure);
    }
    article.append(node("p", s.summary, "story-summary"));
    if (s.tags.length) {
      const tags = node("p", undefined, "story-tags"); tags.setAttribute("aria-label", "主題標籤");
      for (const tag of s.tags) tags.append(node("span", `#${tag}`));
      article.append(tags);
    }
    const sources = node("div", undefined, "story-sources");
    if (s.sources.length > 1) {
      const details = node("details"); details.append(node("summary", `${s.sources.length} sources · 展開來源`));
      const list = node("ul");
      for (const source of s.sources) { const item = node("li"); item.append(link(source)); if (source.published_at) item.append(timeNode(source.published_at)); list.append(item); }
      details.append(list); sources.append(details);
    } else if (s.sources.length === 1) {
      sources.append(link(s.sources[0]));
      if (s.sources[0].published_at) sources.append(timeNode(s.sources[0].published_at));
    } else sources.append(node("p", "DEMO 排版示例 · 無新聞來源", "source-note"));
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
    ui["results-count"].textContent = `顯示 ${filtered.length} / ${state.edition.stories.length} 則`;
    ui["empty-results"].hidden = filtered.length > 0;
    ui["empty-results"].textContent = state.edition.stories.length ? "沒有符合條件的紀事。請調整搜尋文字，或清除篩選條件。" : "本期暫無新聞。收集狀態請見上方本期提要。";
    for (const button of ui["tag-filters"].querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.tag === state.tag));
  }
  function fillSelect(select, values, label, labels = null) {
    select.replaceChildren(new Option(label, ""));
    for (const value of values) select.add(new Option(labels ? labels[value] : value, value));
  }
  function resetFilters() { state.tag = ""; ui["search-input"].value = ""; ui["section-filter"].value = ""; ui["kind-filter"].value = ""; renderResults(); }
  function setupFilters() {
    const stories = state.edition.stories;
    fillSelect(ui["section-filter"], [...new Set(stories.map((s) => s.section).filter(Boolean))], "全部版別");
    fillSelect(ui["kind-filter"], [...new Set(stories.map((s) => s.source_kind))], "全部型態", KINDS);
    const tags = [...new Set(stories.flatMap((s) => s.tags))];
    ui["topic-index"].hidden = tags.length === 0;
    ui["tag-total"].textContent = `（${tags.length}）`;
    ui["tag-filters"].replaceChildren();
    for (const tag of ["", ...tags]) {
      const button = node("button", tag || "全部主題"); button.type = "button"; button.dataset.tag = tag;
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
    if (!state.manifest) return;
    ui["archive-list"].replaceChildren();
    for (const edition of [...state.manifest.editions].sort((a, b) => b.date.localeCompare(a.date))) {
      const item = node("li"); const a = node("a", edition.date);
      a.href = editionURL(edition.date).href; a.dataset.edition = edition.date;
      if (edition.date === state.edition?.date) a.setAttribute("aria-current", "page");
      a.append(node("small", `${edition.story_count} 則${edition.is_demo ? " · SAMPLE / DEMO" : ""}${edition.date === state.manifest.current ? " · 最新一期" : ""}`));
      a.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); openEdition(edition.date, { historyMode: "push", focus: true });
      });
      item.append(a); ui["archive-list"].append(item);
    }
    ui["archive-count"].textContent = `／ ${state.manifest.editions.length} 期`;
  }
  function showMessage(title, detail, error = false) {
    ui["edition-panel"].hidden = true;
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
    ui.main.setAttribute("aria-busy", "true");
    ui["edition-number"].textContent = "NO. —";
    ui["edition-date"].textContent = "調閱本期中"; ui["edition-date"].removeAttribute("datetime");
    ui["updated-time"].textContent = "—"; ui["updated-time"].removeAttribute("datetime");
    document.title = "THE DAILY SIGNAL · 每日情報報";
    showMessage("正在調閱本期…", "讀取目錄與當期內容。");
    try {
      if (!state.manifest || refresh) {
        const manifest = validateManifest(await fetchJSON("data/index.json", signal));
        if (request !== state.request) return;
        state.manifest = manifest;
      }
      renderArchive();
      const target = date === null ? state.manifest.current : date;
      check(day(target), "網址中的 edition 日期無效。請使用 YYYY-MM-DD 格式並從往期存檔選擇。");
      const entry = state.manifest.editions.find((e) => e.date === target);
      check(entry, `目錄中沒有 ${target} 這一期。`);
      const edition = validateEdition(await fetchJSON(entry.path, signal), entry);
      if (request !== state.request) return;
      state.edition = edition;
      ui["edition-number"].textContent = `NO. ${edition.date.replaceAll("-", "")}`;
      ui["edition-date"].textContent = formatDate(edition.date); ui["edition-date"].dateTime = edition.date;
      ui["updated-time"].textContent = formatDate(edition.generated_at); ui["updated-time"].dateTime = edition.generated_at;
      ui["edition-title"].textContent = edition.edition_title || "本期情報";
      ui["edition-summary"].textContent = edition.edition_summary;
      ui["demo-notice"].hidden = !edition.is_demo;
      setupFilters(); renderArchive();
      ui.message.hidden = true; ui["edition-panel"].hidden = false;
      document.title = `${edition.date}${edition.is_demo ? " SAMPLE / DEMO" : ""} · THE DAILY SIGNAL`;
      if (focus) ui["edition-title"].focus({ preventScroll: true });
    } catch (error) {
      if (request !== state.request || signal.aborted) return;
      showMessage("Edition unavailable", error instanceof TypeError ? "連線失敗，無法調閱本期。請檢查網路後重試。" : error.message, true);
      ui["edition-date"].textContent = "本期暫不可用";
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
