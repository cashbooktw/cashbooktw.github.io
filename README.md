# THE DAILY SIGNAL · 每日情報報

個人使用導向、公開託管的 JSON 新聞閱讀器。網站：https://cashbooktw.github.io/ 。公開 repository 與 Pages **不是私人空間**，禁止放入憑證或私人資料。

## Architecture

- 固定前端：`index.html`、`404.html`、`assets/css/newspaper.css`、`assets/js/app.js`、`assets/favicon.svg`。原創復古報紙排版；無框架、外部字型、追蹤、Service Worker 或 build dependency。
- `.nojekyll` 讓 Pages 直接提供靜態檔案。default branch 為 `master`；發布根目錄 `/`。不需要 npm、Jekyll theme 或每日重建前端。
- 啟動時以 `cache: "no-store"` 與 cache-busting 讀 `data/index.json`，由 current 找到 path，再讀單一期數。manifest 僅保留日期與統計，不含新聞全文。
- `?edition=YYYY-MM-DD` 支援歷史期數、重新整理與瀏覽器前進／返回；切換期數不 reload。搜尋限當期 title/deck/summary/tags/source names；篩選由當期版別、來源型態與標籤生成，條件之間取交集，文章保留 JSON 順序。
- 安全 DOM textContent、URL 協定檢查、CSP、外部連結 noopener/noreferrer；支援鍵盤、可見焦點、手機與 reduced motion。沒有圖片也有完整版面。

## Sources

`config/sources.json` 的 `facebook_pages`、`rss_feeds`、`news_search_queries`、`web_pages` 均為字串陣列，初始全部留空。facebook_pages、rss_feeds、web_pages 填入你明確選定的公開 URL；news_search_queries 填入原樣執行的查詢字串。不要放 token、密碼或需登入的私人網址。

新增／修改來源時，明確要求 ChatGPT 使用 GitHub connector 更新該檔指定陣列。這是獨立設定變更，不是每日內容任務；不自動補入任何來源、查詢或排名規則。

## Daily data & automation

正常每日任務 **只能修改兩個檔案**：

1. `data/editions/YYYY-MM-DD.json`（Asia/Taipei 日期；同日重跑更新同檔）
2. `data/index.json`（保留全部歷史項目）

機械化規則在 `automation/UPDATE_RULES.md`；可直接使用的短 prompt 在 `automation/SCHEDULED_TASK_PROMPT.md`。規則調整以 repo 為準，不需要重寫 prompt。此 repo 不會自行建立 ChatGPT 排程；排程執行環境必須實際具備來源讀取與 GitHub 寫入能力，否則須回報失敗。

來源空白、無新內容、讀取失敗皆須如實寫進當期摘要；不以示例新聞填補。當天已有正式新聞時保留，否則可刊行空 stories。

## Edition contract

`schema/edition.schema.json` 使用 JSON Schema Draft 2020-12；驗證時啟用 format 檢查。唯一 story id、manifest 與 edition 一致性另由更新器與前端檢查。發布時間可為已知日期、含時區的 timestamp、空字串或省略；未知不得補造。

正式 edition 為 `is_demo: false`，每則 story 至少一個有 URL 的原始來源。可選 image 為 null 或具 url/alt 的物件；僅使用權利明確的 HTTPS 圖片或 assets/ 下的安全圖片路徑。字串是純文字，不解讀 HTML。

初始 `2026-09-22` 為 `is_demo: true` 的 **SAMPLE / DEMO** 排版示例，沒有真實新聞或真實媒體署名。所有示例內容只在 edition JSON；前端不內嵌新聞。首次正式更新不得混入示例 stories。

## UI changes

明確提出網站功能／外觀變更時，才修改 HTML、CSS 或 JavaScript；涉及資料合約時同步更新 schema 與驗證邏輯。正常 Scheduled Task 不可修改上述檔案、sources、README 或 automation 規則。
