# ChatGPT fast path：評估與操作

維護評估日期：2026-09-23。只改善公開非 Facebook 通道更新；不改 schema v1、既有選稿規則、來源數量、歷史資料或前端。本次維護不發布新聞，也不啟用新排程。

## 六項建議的結論

| 建議 | 採用方式與邊界 |
| --- | --- |
| 合併 GitHub 操作 | 分相依階段處理。connector 有批次能力才使用；本機 updater 提供至多六個並行讀取 worker。不要把一個 helper 呼叫誤稱一次 HTTP。 |
| 六來源平行讀取 | 更新 prompt/規則允許來源間並行；來源內維持「列表 → 候選全文」。按預先配置的來源與列表位置合併，而非完成時間。來源閱讀仍由具備閱讀能力的執行者負責。 |
| 候選先篩時間 | 只排除可證明完全在原時間窗外的文章。未知、粗粒度或跨邊界的發布時間仍需查原文；不自創全來源共用的 24 小時規則。 |
| 機器可讀入口 | 在原六個 web_pages 中新增 discovery，不新增 rss_feeds 項目。Interconnects 使用已驗證 archive，其餘保留已設定入口。 |
| 專用驗證腳本 | validate_chatgpt.py：Draft 2020-12 與 formats、id、日期、索引、正式旗標、歷史保留和常見 secrets。 |
| 可執行 updater | update_chatgpt.py：固定快照、純資料準備、精確 URL 去重、保守合併、inline tree 原子發布、衝突重試與回讀。prepare 不寫 GitHub；publish 需明確旗標及本機環境憑證。 |

### 真正省掉哪些呼叫

GitHub Create Tree 支援 entry.content，會代為建立 blob。因此一般兩檔提交從「兩次 blob + tree + commit + ref」的五個寫入請求，減為「tree + commit + ref」三個，另保留 HEAD 與回讀檢查。相依的 tree、commit、ref 不能並行。若 master 未變，updater 重用固定 SHA 快照；只在競爭時重讀合約與資料。

這是請求數的改善，不是已測得的總耗時改善。全文閱讀、付費牆、分頁、限流與網路延遲仍可能主導耗時；沒有宣稱端到端加速百分比。請以相同來源範圍與完整性要求比較實際執行紀錄。

GitHub 官方依據：[Create a tree](https://docs.github.com/en/rest/git/trees#create-a-tree)、[Update a reference](https://docs.github.com/en/rest/git/refs#update-a-reference)。Schema formats 需明確啟用：[python-jsonschema validation](https://python-jsonschema.readthedocs.io/en/stable/validate/)。

## discovery 設定

每筆是 `{ "kind": "status|listing|archive", "url": "https://..." }`，順序代表嘗試偏好；未配置時才用原 url。入口不代表完整性已獲保證；當次仍須驗證清單覆蓋與分頁。

- Codex Resets：原 status 頁，每次都檢查目前排程；只有 `Reset scheduled` 有可驗證排定時間時才建立 story。沒有 schedule、欄位空白或無法驗證時，只記錄來源已檢查，不發布文章。
- TechCrunch AI、The Decoder、地新聞新竹市與新竹縣：原有分類或文章列表，不放未驗證 RSS。
- Interconnects：`https://www.interconnects.ai/archive` 優先，原首頁備用。2026-09-23 已透過公開網頁讀取確認 archive 可列出文章；不表示付費全文可讀或每次清單都完整。

同次查核中，Interconnects `/feed` 的 XML 無法由目前閱讀工具解析；TechCrunch AI 與 The Decoder RSS 也未完成可用性驗證。因此未將猜測的 feed URL 寫成正式來源。這不是宣稱它們沒有 RSS。日後經使用者明確授權與實測才新增。

來源 scope、name、原 url、rules、順序及六個來源總數均保留。從列表找到的文章仍須屬原設定來源範圍；不能因 archive 或全站 feed 混入其他分類而擴充選稿。

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

候選 edition 必須以快照今日資料為基礎：保留既有 stories 的位置、id、所有非 sources 欄位，以及 sources 的原有前綴；僅追加新 sources 與新 stories。每個新 story 必須包含一個原始來源提供的 HTTPS `image.url`、非空 `alt` 與 `credit`；沒有可驗證來源圖片的候選不加入 stories。既有 story 的 image/null 不回寫。首次當日尚無 edition 時提供完整新期數。不要手動修改快照；它必須來自固定 master SHA 的完整讀取。

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

寫入目標固定 cashbooktw/cashbooktw.github.io 的 master，且只有當日 ChatGPT edition 和 index。GitHub 回應有限時與大小限制，不跟隨 redirect 傳遞憑證。遇 HEAD 競爭先重讀合併；初次失敗後最多三次重試。一般 422、權限或驗證錯誤不冒充競爭無限重試。規則、sources 或 schema 變更時停止重做來源檢查；不強推、不清理、不跨通道去重。

提交後核對 commit 的 tree/parent、兩檔實際內容與目前 master。master 若因其他提交前進，還須確認祖先關係；若資料已被再次改動或驗證期間又前進，回報 unverified 而非假成功。ref 寫入逾時可能是 GitHub 已接受但回應丟失，應帶 commit SHA 回報未確認，不盲目再寫。

## 測試與能力邊界

離線測試覆蓋 schema formats、非法 JSON、索引一致性、圖片/來源/歷史保留、credentials、並行順序、零變更、原子寫入、HEAD 檢查後的競爭、三次重試上限及回讀失敗。Fake API 測試不等於已完成 live CLI 整合測試；實際發布仍需上述回讀。

腳本不會替執行者證明已讀全文、來源清單已窮盡、摘要事實正確、發布時間可驗證或選稿符合原規則。精確 URL 去重不會猜測事件語意；同事件不同 URL 由編輯保留同一既有 id 並追加已驗證 sources。secrets 掃描是保守的常見模式檢查，不是完整 DLP 或無秘密保證。沒有加入無人值守採集器、排程、GitHub Actions 自動發布或自動付費牆處理。
