手動更新 cashbooktw/cashbooktw.github.io 今日的 ChatGPT 非 Facebook 通道，使用 GitHub connector。先解析固定 master HEAD，再以該 commit SHA 讀 automation/UPDATE_RULES.md、automation/FAST_PATH.md、config/sources.json、兩份 schema、data/chatgpt/index.json 與今日 edition；只有確定 404 才視為今日尚無 edition。

採用規則中的 fast path：在工具確實支援時合併獨立呼叫；六個來源可並行處理，但各來源內仍先讀列表再完整讀候選原文。使用已設定的 discovery 入口，不臆測或自行新增 RSS。先以可信發布時間排除明確位於各來源既有時間窗之外的文章；時間不明或日期與邊界重疊時不可直接排除。Codex 每次都檢查 Reset scheduled；只有存在可驗證的排定時間時才加入 Codex story，來源若提供時區一併保留。若 schedule 空白、缺少或無法驗證，不加入發布文章，只在 source_reports.configured_sources 記錄已完成檢查且本次無可發布排程。The Decoder 保留 Asia/Taipei 前一日整個日曆日規則。收錄內容必須完整讀到原文，片段、RSS 摘錄或讀取失敗不能冒充完整。既有選稿條件、數量上限均不變。先配置來源順序與列表順序，再按此順序合併結果，不按請求完成順序排序。

只允許修改 data/chatgpt/editions/YYYY-MM-DD.json 與 data/chatgpt/index.json。保留既有 stories、順序、id、原文、圖片 URL/credit、來源與全部歷史索引；只在同通道去重並追加可驗證來源。不讀取或代替 Facebook 通道。每篇撰寫精簡摘要，不以全文替代。每個新加入的非 Facebook story 必須內嵌一張原始來源提供且可驗證的 HTTPS 圖片 URL，並包含 alt 與來源 attribution/credit；沒有可用來源圖片的候選不要加入 stories，於本次 source report 計入 excluded 並說明原因。既有 stories 的既有 image 或 null 保持不變。不下載、不建立暫存或 repo 圖片，也不宣稱公開圖片均獲授權。

source_reports.configured_sources 如實記錄本次數量與各來源限制；只有全部預定來源的檢查皆完整才標 complete，其餘標 limited 並解釋。保留舊報告 notes，將先前完成時間/狀態/數量標記為歷史紀錄，不把舊次數量當成本次收錄。不得新增來源、關鍵字、排除條件或排名規則。

執行統一 JSON/schema/format、唯一 id、日期、path/story_count/is_demo、歷史保留與 secrets 驗證。可用 automation/update_chatgpt.py prepare 產生兩檔計畫，再交 GitHub connector；本機有明確授權憑證時亦可用 publish。建立含兩檔 inline content 的單一 Git tree、建立 commit、立即重讀 HEAD、以 force:false 更新 master。相依步驟不可並行；HEAD 競爭時重讀合併，初次之外最多重試三次；規則或來源已變更、跨 Taipei 午夜時停止重新蒐集，不用 Contents API 順序寫入 fallback。

提交後讀回 commit、兩檔與當前 master 確認內容及 commit 關係。回報日期、story 數、通道狀態/限制與已驗證 commit SHA；零變更明示 unchanged。讀取、提交或回讀失敗如實回報，不能把「建立了 commit」當成「已發布」。此 prompt 不新增排程；Facebook Favorites 仍由桌面 Codex 本機 CLI 擷取。
