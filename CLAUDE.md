# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

會議室預約看板：純前端（HTML + CSS + 原生 JS），無建置步驟、無相依套件，資料存在 localStorage。需求與驗收標準（AC1–AC15）以 `spec.md` 為準；「非目標」一節列出本版刻意不做的功能（登入、後端同步、重複預約、跨日預約等），新增功能前先對照。

技術限制：前端限定 `index.html` + `style.css` + `app.js` + `test.html` 四檔，禁止再拆分其他檔案、禁止外部框架；`app.js` 以一般 `<script src="app.js">` 載入，不要改成 ES module（頁面需能直接雙擊開啟）。`tests/`、`package.json` 屬測試工具，不在此限。

UI 文字、程式註解與測試訊息皆使用繁體中文，修改時請維持一致。

## 指令

- 執行：直接開啟 `index.html`，或用任何靜態伺服器提供此資料夾。
- 測試：`npm test`（= `node tests/ac-test.mjs`）。需要 Node 22 以上（使用內建 `fetch` / `WebSocket`）與本機 Chrome 或 Edge；找不到瀏覽器時以環境變數 `CHROME_PATH` 指定。截圖輸出到 `tests/output/`（已 gitignore）。
- 沒有 lint 設定，也沒有單一測試的執行方式：`ac-test.mjs` 是一支依序執行的腳本，後面的檢查依賴前面建立的預約狀態（例如 AC9 修改的是 AC4 建立的「週會」），不能單獨跑某一條。要除錯某條 AC 時，可暫時註解掉其後的區塊。

## 架構

- `app.js` 是單一 IIFE，依序分為：設定常數 → 日期／時間工具 → 資料存取（`loadBookings` / `saveBookings` / `findConflict`）→ `state` 物件 → 繪製函式 → 表單 → 事件綁定 → 啟動。
- 繪製採「狀態改變後整體重繪」：修改 `state` 後呼叫 `render()`（或只呼叫 `renderGrid()`），各 `render*` 以 `replaceChildren` 重建 DOM，沒有增量更新。每分鐘的 `setInterval` 負責更新目前時間線；跨週時若使用者正在看本週，會自動切到新的一週（看其他週則不動）。
- 時間一律以「當日分鐘數」計算（`toMin` / `toTime`），日期以本地時區的 `YYYY-MM-DD` 字串表示（`toDateStr` / `parseDate`），不要用 `Date.toISOString()`，否則會有時區偏移。一週從週一開始（`startOfWeek`）。
- 預約色塊以絕對定位擺放：`top = (分鐘 / SLOT_MIN) * SLOT_PX`。`app.js` 的 `SLOT_PX` 必須與 `style.css` 的 `--slot` 相同（目前 24px），測試中的 `clickSlot` 與 AC4 的 `top === '433px'` 也寫死了這個值。
- 衝突判斷：同會議室、同日期、`start < 他人.end && 他人.start < end`，並排除相同 `id`（修改時排除自己）；首尾相接不算重疊。
- localStorage 使用單一 key `meeting-room-board.bookings` 存 JSON 陣列。讀取時 JSON 損毀回傳空陣列，並以 `isValidBooking` 濾掉不合格的筆數；寫入失敗時 `saveBookings` 回傳 `false`，呼叫端顯示錯誤且不更新 `state`。
- 預約人顏色由 `hueFor(name)` 雜湊出色相，透過 CSS 變數 `--hue` 套用到 `.booking`。

## 測試的運作方式

`tests/ac-test.mjs` 不使用任何測試框架：它啟動 headless Chrome（`--remote-debugging-port=0`，從 profile 內的 `DevToolsActivePort` 讀取埠號），透過 CDP 開啟 `file://` 的 `index.html`，以 `Runtime.evaluate` 在頁面內操作 DOM 並逐條檢查 AC。測試依賴 DOM 的 id（`fBooker`、`fTitle`、`bookingForm`、`formError`、`weekLabel`、`roomTabs`、`exportDate`、`exportCsv` 等）與 class（`.day-col.today`、`.booking`、`.dimmed`、`.now-line`），以及錯誤訊息中的關鍵字（「姓名」「主題」「結束時間」「衝突」「正整數」），更動這些時要同步更新測試。結束時以 CDP `Browser.close` 關閉，失敗時由 `cleanup()` 依 profile 路徑強制結束殘留的 Chrome 行程。
