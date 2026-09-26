# ChatGPT fast path：評估與操作

維護評估日期：2026-09-23。只改善公開非 Facebook 通道更新；不改 schema v1、既有選稿規則、來源數量、歷史資料或前端。本次維護不發布新聞，也不啟用新排程。

## 六項建議的結論

| 建議 | 採用方式與邊界 |
| --- | --- |
| 合併 GitHub 操作 | 分相依階段處理。connector 有批次能力才使用；本機 updater 提供至多六個並行讀取 worker。不要把一個 helper 呼叫誤稱一次 HTTP。 |
| 依設定來源平行讀取 | 依 `config/sources.json` 實際 `web_pages` 數量啟動來源工作，不硬編碼來源總數；來源間可並行，來源內維持「列表／archive／status → 候選全文」。按預先配置的來源與列表位置合併，而非完成時間。來源閱讀仍由具備閱讀能力的執行者負責。 |
| 候選先篩時間 | 只排除可證明完全在原時間窗外的文章。未知、粗粒度或跨邊界的發布時間仍需查原文；不自創全來源共用的 24 小時規則。 |
| 機器可讀入口 | discovery 僅附著於 `config/sources.json` 實際設定的 web_pages，不新增 rss_feeds 項目。Interconnects 使用已驗證 archive，其餘保留已設定入口。 |
| 專用驗證腳本 | validate_chatgpt.py：Draft 2020-12 與 formats、id、日期、索引、正式旗標、歷史保留和常見 secrets。 |
| 可執行 updater | update_chatgpt.py：固定快照、純資料準備、精確 URL 去重、保守合併、inline tree 原子發布、衝突重試與回讀。prepare 不寫 GitHub；publish 需明確旗標及本機環境憑證。 |

### 真正省掉哪些呼叫

GitHub Create Tree 支援 entry.content，會代為建立 blob。因此一般兩檔提交從「兩次 blob + tree + commit + ref」的五個寫入請求，減為「tree + commit + ref」三個，另保留 HEAD 與回讀檢查。相依的 tree、commit、ref 不能並行。若 master 未變，updater 重用固定 SHA 快照；只在競爭時重讀合約與資料。

這是請求數的改善，不是已測得的總耗時改善。全文閱讀、付費牆、分頁、限流與網路延遲仍可能主導耗時；沒有宣稱端到端加速百分比。請以相同來源範圍與完整性要求比較實際執行紀錄。

GitHub 官方依據：[Create a tree](https://docs.github.com/en/rest/git/trees#create-a-tree)、[Update a reference](https://docs.github.com/en/rest/git/refs#update-a-reference)。Schema formats 需明確啟用：[python-jsonschema validation](https://python-jsonschema.readthedocs.io/en/stable/validate/)。

## discovery 設定

每筆是 `{ "kind": "status|listing|archive", "url": "https://..." }`，順序代表嘗試偏好；未配置時才用原 url。入口不代表完整性已獲保證；當次仍須驗證清單覆蓋與分頁。

- Codex Resets：原 status 頁，每次都檢查目前排程；只有 `Reset scheduled` 有可驗證排定時間時才建立 story。沒有 schedule、欄位空白或無法驗證時，只記錄來源已檢查，不發布文章。
- TechCrunch AI、The Decoder：使用原有分類或文章列表，不放未驗證 RSS。
- 地新聞新竹市、新竹縣：優先使用已驗證的同站 `/hsinchuCity/news`、`/hsinchuCounty/news` 快報列表，因其直接按日期列出候選；原區域首頁保留作 fallback。這些都是同一既有來源的 listing，不是新增來源，也不是 RSS。
- Interconnects：`https://www.interconnects.ai/archive` 優先，原首頁備用。2026-09-23 已透過公開網頁讀取確認 archive 可列出文章；不表示付費全文可讀或每次清單都完整。

同次查核中，Interconnects `/feed` 的 XML 無法由目前閱讀工具解析；TechCrunch AI 與 The Decoder RSS 也未完成可用性驗證。因此未將猜測的 feed URL 寫成正式來源。這不是宣稱它們沒有 RSS。日後經使用者明確授權與實測才新增。

來源 scope、name、原 url、rules 與順序均以 `config/sources.json` 為準；來源總數不得在文件或執行器中硬編碼。從列表找到的文章仍須屬原設定來源範圍；不能因 archive 或全站 feed 混入其他分類而擴充選稿。

相對時間（例如「9 小時前」「15 小時前」「23 小時前」）不是排除理由。這類候選仍需讀完整原文，並用同一來源的列表／archive、實際執行時間及可驗證時區解析日曆日期；只有合理查證後仍無法符合該來源既有日期要求時才排除。不得把事件日期、頁面更新時間或 sitemap `lastmod` 當成發布日期。

對 Latent Space 等同時含免費與付費項目的既有來源，先列完並讀取當日所有符合範圍的免費全文候選，再處理付費候選的限制。只有免費全文不足且其餘符合日期候選確因付費牆／登入限制無法完整讀取時，才在 source report 記錄 paid limitation；看到單一 Paid 項目不代表整個來源不可用。

全文讀取的暫時性失敗採有限重試：一旦已取得候選 canonical URL，若閱讀工具回報 timeout、暫時性網路失敗或 parser/fetch failure，對同一 canonical URL 最多再嘗試 2 次；若當前環境另有 reader/fetch 模式，只能用來讀同一原始 URL，不得用搜尋片段、mirror、cache、RSS 摘錄或第三方轉載代替原文。來源的 listing／archive／status 已完整列舉並先固定 acquisition position 後，各候選原文可在工具支援時並行讀取，但合併仍依固定位置。TechCrunch AI 等需從候選中挑代表作或有 max-N 上限的來源，不能在仍有已知時間窗內候選未讀時，只因已成功讀到任意篇數就提前停止比較；重試後仍失敗才如實標 limited，並在 notes 記錄剩餘失敗數與重試覆蓋。

## 安裝與驗證

Python 3.10+，系統需提供 Asia/Taipei 時區資料。套件只供 automation 使用；不增加 Pages build dependency，也不依賴 Facebook importer。

```sh
python -m pip install -r automation/requirements.txt
python automation/validate_chatgpt.py --all
python -m unittest discover -s automation -p 'test_chatgpt.py' -v
```

`--all` 只讀 ChatGPT 索引中的歷史期數。驗證候選可指定 `--date`、`--edition`、`--index`、`--previous-edition`、`--previous-index`；使用兩個 previous 參數才能另外檢查相對基準的保留性。每日 updater 會自動帶入基準。

## 取得快照、人工閱讀、準備計畫

```sh
python automation/update_chatgpt.py snapshot --out /tmp/chatgpt-snapshot.json
# 執行者讀快照中的規則與來源，並行檢查來源、完整讀候選原文。
# 將通過編輯審查的完整 schema-v1 edition 放到 /tmp/chatgpt-candidate.json。
python automation/update_chatgpt.py prepare \
  --snapshot /tmp/chatgpt-snapshot.json \
  --edition /tmp/chatgpt-candidate.json \
  --out /tmp/chatgpt-plan.json
```

候選 edition 必須以快照今日資料為基礎：保留既有 stories 的位置、id、所有非 sources 欄位，以及 sources 的原有前綴；僅追加新 sources 與新 stories。新 story 若原始來源頁面直接提供且工具可可靠取得 HTTPS 圖片 URL，填入 `image.url`、非空 `alt` 與 `credit`；只確認 URL 為來源頁面提供的 HTTPS URL，不額外判定授權。若來源未提供圖片或工具無法可靠取得 URL，允許 `image: null`，不得僅因缺圖排除候選或把來源標 limited。既有 story 的 image/null 不回寫。首次當日尚無 edition時，確認 404 視為正常 absent 狀態，直接依 index/schema 提供完整新期數，不列 failure/limitation。不要手動修改快照；它必須來自固定 master SHA 的完整讀取。

`source_reports.configured_sources` 填本次完成時間、狀態、數量與各來源實際限制。更新器保留所有舊 notes，將先前報告的時間/狀態/數量用有標籤的歷史紀錄追加至 notes，使用較新 completed_at 的報告作頂層計數。舊次 limited 不被抹除，也不冒充本次狀態。內容、報告皆未變則回傳 unchanged；新一次檢查要有新的實際 completed_at。

prepare 只產生兩個允許路徑的 JSON 字串與 Git tree 基準資料，沒有網路寫入。它使用實際執行時間並拒絕改寫過去日期；跨 Taipei 午夜需重新取得快照與蒐集來源。相同快照、候選與注入的測試時鐘會產生相同結果；實際執行時間與 GitHub commit metadata 本來就會隨執行改變。

## 發布：connector 或明確授權的本機 CLI

ChatGPT 使用 GitHub connector 時，依計畫建立帶 base_tree 的單一 tree（兩個 entry 都是 mode 100644、type blob、content），再建立單 parent commit。立即重讀 master；未變才以 force:false 更新 ref。若 connector 不支援必要 Git Data 動作，停止，不用逐檔更新替代。connector 的授權不會自動變成本機 token。

在已授權、可連 GitHub API 的本機環境，憑證只能放 GH_TOKEN 或 GITHUB_TOKEN 環境變數，需該 repository 的 Contents write 權限。不要貼到對話、命令列參數、JSON、Git 或 logs。明確發布命令為：

```sh
python automation/update_chatgpt.py publish \
  --snapshot /tmp/chatgpt-snapshot.json \
  --edition /tmp/chatgpt-candidate.json \
  --confirm-master
```

寫入目標固定 cashbooktw/cashbooktw.github.io 的 master，且只有當日 ChatGPT edition 和 index。GitHub 回應有限時與大小限制，不跟隨 redirect 傳遞憑證。只有確認 HEAD 競爭才重讀合併，初次之外最多三次 conflict retry。connector safety denial、403/權限拒絕、branch protection、一般 422/validation error 等非競爭錯誤直接回報，不進 conflict retry。若 connector 寫入被拒，只有執行環境已存在明確授權的 `GH_TOKEN` 或 `GITHUB_TOKEN` 時才可改走上述 local `publish`；connector 授權不能當成本機 token。不得改用 Contents API 順序寫入 fallback。規則、sources 或 schema 變更時停止重做來源檢查；不強推、不清理、不跨通道去重。

提交後核對 commit 的 tree/parent、兩檔實際內容與目前 master。master 若因其他提交前進，還須確認祖先關係；若資料已被再次改動或驗證期間又前進，回報 unverified 而非假成功。ref 寫入逾時可能是 GitHub 已接受但回應丟失，應帶 commit SHA 回報未確認，不盲目再寫。

## 測試與能力邊界

離線測試覆蓋 schema formats、非法 JSON、索引一致性、圖片/來源/歷史保留、credentials、並行順序、零變更、原子寫入、HEAD 檢查後的競爭、三次重試上限及回讀失敗。Fake API 測試不等於已完成 live CLI 整合測試；實際發布仍需上述回讀。

腳本不會替執行者證明已讀全文、來源清單已窮盡、摘要事實正確、發布時間可驗證或選稿符合原規則。精確 URL 去重不會猜測事件語意；同事件不同 URL 由編輯保留同一既有 id 並追加已驗證 sources。secrets 掃描是保守的常見模式檢查，不是完整 DLP 或無秘密保證。沒有加入無人值守採集器、排程、GitHub Actions 自動發布或自動付費牆處理。
