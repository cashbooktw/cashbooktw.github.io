import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const json = async (path) => JSON.parse(await read(path));
const validateWith = (schema, value) => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return [validate(value), validate.errors];
};

async function render({ manifests, editions, failedPaths = [], date = null }) {
  const { document } = parseHTML(await read("index.html"));
  Object.defineProperty(document, "baseURI", { value: "https://cashbooktw.github.io/" });
  for (const select of document.querySelectorAll("select")) {
    select.add = (option) => select.append(option);
    let value = "";
    Object.defineProperty(select, "value", { get: () => value, set: (next) => { value = next; } });
  }
  const values = new Map(Object.entries({ ...manifests, ...editions }));
  const fetch = async (input) => {
    const path = new URL(String(input)).pathname.slice(1);
    if (failedPaths.includes(path)) throw new TypeError("network down");
    if (!values.has(path)) return { ok: false, status: 404 };
    return { ok: true, json: async () => values.get(path) };
  };
  const window = { location: { href: `https://cashbooktw.github.io/${date ? `?edition=${date}` : ""}` }, addEventListener() {}, scrollTo() {} };
  const Option = function (label, value) {
    const option = document.createElement("option");
    option.textContent = label;
    Object.defineProperty(option, "value", { value, writable: true });
    return option;
  };
  runInNewContext(await read("assets/js/app.js"), {
    document, window, URL, Intl, Date, TypeError, AbortController, setTimeout, clearTimeout, fetch,
    history: { pushState() {}, replaceState() {} }, Option,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return document;
}

const channelData = async (channel) => {
  const manifestPath = `data/${channel}/index.json`;
  const manifest = await json(manifestPath);
  return { manifestPath, manifest, editions: Object.fromEntries(await Promise.all(manifest.editions.map(async (entry) => [entry.path, await json(entry.path)]))) };
};

test("channel manifest and edition schemas accept the real split-channel data", async () => {
  const manifestSchema = await json("schema/manifest.schema.json");
  const editionSchema = await json("schema/edition.schema.json");
  for (const channel of ["facebook", "chatgpt"]) {
    const { manifest, editions } = await channelData(channel);
    const [validManifest, manifestErrors] = validateWith(manifestSchema, manifest);
    assert.equal(validManifest, true, JSON.stringify(manifestErrors));
    for (const edition of Object.values(editions)) {
      const [validEdition, editionErrors] = validateWith(editionSchema, edition);
      assert.equal(validEdition, true, `${channel}/${edition.date}: ${JSON.stringify(editionErrors)}`);
    }
  }
  const legacy = await json("data/editions/2026-09-22.json");
  assert.equal(validateWith(editionSchema, legacy)[0], true, "legacy archive editions remain schema-readable");
});

test("reader renders each real channel edition and unions its archive dates", async () => {
  const facebook = await channelData("facebook");
  const chatgpt = await channelData("chatgpt");
  const manifests = { [facebook.manifestPath]: facebook.manifest, [chatgpt.manifestPath]: chatgpt.manifest };
  const editions = { ...facebook.editions, ...chatgpt.editions };
  for (const [channel, fixture] of [["facebook", facebook], ["chatgpt", chatgpt]]) {
    const entry = fixture.manifest.editions[0];
    const doc = await render({ manifests, editions, date: entry.date });
    assert.equal(doc.querySelectorAll(".story").length, entry.story_count);
    assert.match(doc.querySelector(".story h3").textContent, /.+/);
  }
  const doc = await render({ manifests, editions });
  assert.equal(doc.querySelectorAll("#archive-list a").length, 2);
  assert.equal(doc.querySelector("#channel-status").hidden, true, "a channel that has no edition that date is not an error");
  assert.equal(doc.querySelector("#edition-title"), null);
  assert.equal(doc.querySelector("#source-reports"), null);
});

test("reader merges same-date editions Facebook first and safely distinguishes duplicate ids", async () => {
  const facebook = await channelData("facebook");
  const chatgpt = await channelData("chatgpt");
  const date = "2026-09-23";
  const fbEdition = structuredClone(Object.values(facebook.editions)[0]);
  const chatEdition = structuredClone(Object.values(chatgpt.editions)[0]);
  for (const edition of [fbEdition, chatEdition]) edition.date = date;
  chatEdition.stories[0].id = fbEdition.stories[0].id;
  const entry = (channel, edition) => ({ date, path: `data/${channel}/editions/${date}.json`, story_count: edition.stories.length, is_demo: edition.is_demo });
  const makeManifest = (entries) => ({ schema_version: 1, current: date, updated_at: "2026-09-23T12:00:00+08:00", editions: entries });
  const doc = await render({
    manifests: {
      "data/facebook/index.json": makeManifest([entry("facebook", fbEdition)]),
      "data/chatgpt/index.json": makeManifest([entry("chatgpt", chatEdition)]),
    },
    editions: {
      [entry("facebook", fbEdition).path]: fbEdition,
      [entry("chatgpt", chatEdition).path]: chatEdition,
    },
  });
  const stories = [...doc.querySelectorAll(".story")];
  assert.equal(stories.length, fbEdition.stories.length + chatEdition.stories.length);
  assert.match(stories[0].id, /^story-facebook-/);
  assert.match(stories[fbEdition.stories.length].id, /^story-chatgpt-/);
  assert.equal(new Set(stories.map((story) => story.id)).size, stories.length);
  assert.equal(doc.querySelectorAll(".story--lead").length, 1);
  assert.equal(doc.querySelector("#channel-status").hidden, false, "a limited channel report is surfaced");
  assert.match(doc.querySelector("#channel-status").textContent, /ChatGPT: 有限讀取/);
});

test("channel failures leave the other channel readable and limited notes are reported", async () => {
  const facebook = await channelData("facebook");
  const chatgpt = await channelData("chatgpt");
  const date = facebook.manifest.current;
  const chatEntry = { ...chatgpt.manifest.editions[0], date, path: `data/chatgpt/editions/${date}.json` };
  const chatManifest = { ...chatgpt.manifest, current: date, editions: [chatEntry] };
  const fbEntry = facebook.manifest.editions[0];
  const fbEdition = structuredClone(facebook.editions[fbEntry.path]);
  fbEdition.source_reports = { facebook: { status: "limited", completed_at: fbEdition.generated_at, captured: 2, included: 1, excluded: 1, notes: ["部分貼文無法讀取"] } };
  const doc = await render({
    manifests: { [facebook.manifestPath]: facebook.manifest, [chatgpt.manifestPath]: chatManifest },
    editions: { [fbEntry.path]: fbEdition },
    failedPaths: [chatEntry.path],
  });
  assert.equal(doc.querySelectorAll(".story").length, fbEntry.story_count);
  assert.match(doc.querySelector("#channel-status").textContent, /ChatGPT: 讀取失敗/);
  assert.match(doc.querySelector("#channel-status").textContent, /Facebook: 有限讀取/);
  assert.match(doc.querySelector("#channel-status").textContent, /部分貼文無法讀取/);
});

test("reader keeps original text safe, hides failed images, and suppresses routine complete notes", async () => {
  const facebook = await channelData("facebook");
  const chatgpt = await channelData("chatgpt");
  const entry = facebook.manifest.editions[0];
  const edition = structuredClone(facebook.editions[entry.path]);
  edition.stories[0].original_text = "原文第一行\n<script>不是標記</script>";
  edition.stories[0].image = { url: "assets/images/facebook/2026-09-23/missing.jpg", alt: "Example", credit: "來源 attribution" };
  edition.source_reports = { facebook: { status: "complete", completed_at: edition.generated_at, captured: 2, included: 1, excluded: 1, notes: ["例行圖片來源說明不應顯示"] } };
  const doc = await render({
    manifests: { [facebook.manifestPath]: facebook.manifest, [chatgpt.manifestPath]: chatgpt.manifest },
    editions: { [entry.path]: edition },
  });
  const story = doc.querySelector(".story");
  assert.equal(story.querySelector("details.story-original script"), null);
  assert.match(story.textContent, /<script>不是標記<\/script>/);
  assert.equal(doc.querySelector("#channel-status").hidden, true, "an intentionally absent date is not a channel failure");
  assert.doesNotMatch(doc.querySelector("#channel-status").textContent, /例行圖片/);
  const image = story.querySelector("img");
  image.dispatchEvent(new doc.defaultView.Event("error"));
  assert.equal(story.querySelector("figure").hidden, true);
});

test("reader assets have content versions matching their current bytes", async () => {
  const { document } = parseHTML(await read("index.html"));
  for (const [selector, attribute] of [["script[src]", "src"], ['link[rel="stylesheet"]', "href"]]) {
    const url = new URL(document.querySelector(selector).getAttribute(attribute), "https://cashbooktw.github.io/");
    const hash = createHash("sha256").update(await read(url.pathname.slice(1))).digest("hex").slice(0, 12);
    assert.equal(url.searchParams.get("v"), hash, `Version must match ${url.pathname}`);
  }
});
