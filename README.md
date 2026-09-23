# THE DAILY SIGNAL · 每日情報報

個人使用導向、公開託管的 JSON 新聞閱讀器。網站：https://cashbooktw.github.io/ 。公開 repository 與 Pages **不是私人空間**，禁止放入憑證或私人資料。

## Architecture

- 固定前端：`index.html`、`404.html`、`assets/css/newspaper.css`、`assets/js/app.js`、`assets/favicon.svg`。原創復古報紙排版；無框架、外部字型、追蹤、Service Worker 或 build dependency。
- `.nojekyll` 讓 Pages 直接提供靜態檔案。default branch 為 `master`；發布根目錄 `/`。不需要 npm、Jekyll theme 或每日重建前端。
- 啟動時以 `cache: "no-store"` 與 cache-busting 讀 `data/index.json`，由 current 找到 path，再讀單一期數。manifest 僅保留日期與統計；原文與來源讀取報告收在對應 edition。
- `?edition=YYYY-MM-DD` 支援歷史期數、重新整理與瀏覽器前進／返回；切換期數不 reload。搜尋限當期 title/deck/summary/tags/source names；篩選由當期版別、來源型態與標籤生成，條件之間取交集，文章保留 JSON 順序。
- 安全 DOM textContent、URL 協定檢查、CSP、外部連結 noopener/noreferrer；支援鍵盤、可見焦點、手機與 reduced motion。沒有圖片也有完整版面。

## Sources

`config/sources.json` 的 `facebook_pages`、`rss_feeds`、`news_search_queries` 是字串陣列；`web_pages` 是含 `name`、`url` 與可選來源規則的物件陣列。Facebook Favorites 由桌面匯入程式讀取，本檔不設定或擷取 Facebook 來源。現有六個 `web_pages` 來源為 Codex Resets、TechCrunch AI、Interconnects、The Decoder、新竹市地方新聞與新竹縣地方新聞，選稿上限與條件見各來源的 `rules`。ChatGPT 更新時只處理這些公開非 Facebook 來源與本檔查詢，不自行補來源、關鍵字或排名規則。

新增／修改來源時，需明確要求使用 GitHub connector 更新該檔指定欄位。不要放 token、密碼或需登入的私人網址。來源設定變更與每日內容更新是不同工作。

## Daily data & automation

正常每日任務 **只能修改兩個檔案**：

1. `data/editions/YYYY-MM-DD.json`（Asia/Taipei 日期；同日重跑更新同檔）
2. `data/index.json`（保留全部歷史項目）

操作規則在 `automation/UPDATE_RULES.md`；`automation/SCHEDULED_TASK_PROMPT.md` 是手動執行 ChatGPT 非 Facebook 來源通道的 prompt。Facebook Favorites 由桌面 Codex 的本機 CLI 匯入程式擷取；ChatGPT 不代替該程式讀 Facebook。自動執行環境必須確實具備來源讀取與 GitHub 寫入能力，否則須回報失敗。

來源空白、無新內容、讀取失敗皆須如實回報；每期可用 `source_reports` 分別記錄 Facebook 與設定來源通道。缺少通道報告代表未記錄，不能宣稱完整。不以示例新聞填補；既有正式 stories 與歷史期數都保留。

## Edition contract

`schema/edition.schema.json` 使用 JSON Schema Draft 2020-12；驗證時啟用 format 檢查。唯一 story id、manifest 與 edition 一致性另由更新器與前端檢查。發布時間可為已知日期、含時區的 timestamp、空字串或省略；未知不得補造。

正式 edition 為 `is_demo: false`，每則 story 至少一個有 URL 的原始來源。`summary` 是摘要；Facebook story 可另帶可選 `original_text`，前端以純文字在可展開區塊呈現並保留換行，不解讀 HTML。可選 image 為 null 或具 url/alt 的物件；僅使用權利明確的原文 HTTPS 圖片，不把每日圖片存進 repo。`source_reports` 可分別包含 `facebook` 與 `configured_sources` 報告，報告記錄狀態、完成時間、讀取/收錄/排除數與備註；沒有該欄代表沒有可驗證的通道狀態。

`is_demo: true` 只用於明確標示的版面示例，不得混入正式 edition。現有歷史期數是正式內容；每日更新不得重寫或刪除既有 stories 與 editions。前端不內嵌新聞。

## UI changes

明確提出網站功能／外觀變更時，才修改 HTML、CSS 或 JavaScript；涉及資料合約時同步更新 schema 與驗證邏輯。正常 Scheduled Task 不可修改上述檔案、sources、README 或 automation 規則。

## Verification

網站保持無 build dependency。合約與 DOM 回歸測試重用本機 importer 的 Ajv/linkedom；設定 `FB_IMPORT_ROOT` 為該專案位置，再執行 `node --test tests/edition-contract.test.mjs`。另執行 `node --check assets/js/app.js` 與 `git diff --check`。
