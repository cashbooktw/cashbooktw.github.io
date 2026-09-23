import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { resolve } from "node:path";

const require = createRequire(resolve(process.env.FB_IMPORT_ROOT ?? "../facebook-edition-import", "package.json"));
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { parseHTML } = require("linkedom");
const root = new URL("../", import.meta.url);
const read = async (path) => readFile(new URL(path, root), "utf8");

function validator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("edition schema keeps existing editions valid and accepts source reports and Facebook original text", async () => {
  const schema = JSON.parse(await read("schema/edition.schema.json"));
  const validate = validator(schema);
  const legacyEdition = JSON.parse(await read("data/editions/2026-09-22.json"));
  assert.equal(validate(legacyEdition), true, JSON.stringify(validate.errors));
  const edition = JSON.parse(await read("data/editions/2026-09-23.json"));
  edition.source_reports = {
    facebook: { status: "complete", completed_at: "2026-09-23T00:12:00+08:00", captured: 4, included: 2, excluded: 2, notes: [] },
    configured_sources: { status: "limited", completed_at: "2026-09-23T00:13:00+08:00", captured: 3, included: 1, excluded: 1, notes: ["有一篇原文無法讀取"] },
  };
  edition.stories[0].original_text = "第一行\n<script>alert('text only')</script>";

  assert.equal(validate(edition), true, JSON.stringify(validate.errors));
  edition.source_reports.facebook.included = -1;
  assert.equal(validate(edition), false);
});

test("reader renders original text safely and shows an absent source channel as not recorded", async () => {
  const { document } = parseHTML(await read("index.html"));
  Object.defineProperty(document, "baseURI", { value: "https://cashbooktw.github.io/" });
  for (const select of document.querySelectorAll("select")) {
    select.add = (option) => select.append(option);
    let value = "";
    Object.defineProperty(select, "value", { get: () => value, set: (next) => { value = next; } });
  }
  const window = { location: { href: "https://cashbooktw.github.io/" }, addEventListener() {}, scrollTo() {} };
  const edition = JSON.parse(await read("data/editions/2026-09-23.json"));
  edition.source_reports = {
    configured_sources: { status: "limited", completed_at: "2026-09-23T00:13:00+08:00", captured: 3, included: 1, excluded: 1, notes: ["有一篇原文無法讀取"] },
  };
  edition.stories[0].image = {url:"https://example.org/photo.jpg",alt:"Example source image"};
  edition.stories[0].original_text = "原文第一行\n<script>不是標記</script>";
  const manifest = { schema_version: 1, current: edition.date, updated_at: edition.generated_at, editions: [{ date: edition.date, path: `data/editions/${edition.date}.json`, story_count: edition.stories.length, is_demo: false }] };
  const fetch = async (url) => ({ ok: true, json: async () => String(url).includes("index.json") ? manifest : edition });
  const Option = function (label, value) { const option = document.createElement("option"); option.textContent = label; Object.defineProperty(option, "value", { value, writable: true }); return option; };

  runInNewContext(await read("assets/js/app.js"), { document, window, URL, Intl, Date, TypeError, AbortController, setTimeout, clearTimeout, fetch, history: { pushState() {}, replaceState() {} }, Option });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("edition-panel").hidden, false, document.getElementById("message-detail").textContent);
  const story = document.querySelector(".story");
  assert.equal(story.querySelector("details.story-original").textContent.includes("原文第一行\n<script>不是標記</script>"), true);
  assert.equal(story.querySelector("details.story-original script"), null);
  assert.match(document.getElementById("source-reports").textContent, /未記錄/);
  assert.match(document.getElementById("source-reports").textContent, /有限讀取/);
  assert.match(document.getElementById("source-reports").textContent, /有一篇原文無法讀取/);
  assert.equal(story.querySelectorAll("img").length,1);
  assert.equal(document.querySelectorAll(".story")[1].querySelector("figure"),null);
  story.querySelector("img").dispatchEvent(new document.defaultView.Event("error"));
  assert.equal(story.querySelector("figure").hidden,true);
  assert.match(story.textContent,/原文第一行/);
});
