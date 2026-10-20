// 以 headless Chrome（CDP）逐條驗證 spec.md 的驗收標準
// 執行：npm test（或 node tests/ac-test.mjs），需要 Node 22 以上與 Chrome / Edge
// 截圖輸出到 tests/output/；瀏覽器路徑可用環境變數 CHROME_PATH 指定
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageFile = join(here, '..', 'index.html');
const outDir = join(here, 'output');
mkdirSync(outDir, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome / Edge，請以環境變數 CHROME_PATH 指定瀏覽器執行檔路徑。');
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'mrb-test-profile-'));
// port 0：由 Chrome 自選空閒埠，寫入 profile 內的 DevToolsActivePort
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });

// 正常結束時以 CDP Browser.close 關閉；這裡是保底：依 profile 路徑強制結束所有相關行程
// （Windows 上 Chrome 會交棒給其他行程，kill() 或 taskkill /T 都無法涵蓋）
function cleanup() {
  if (process.platform === 'win32') {
    const dir = profile.replace(/'/g, "''");
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='${basename(CHROME)}'" | Where-Object { $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
    { stdio: 'ignore' });
  } else {
    spawnSync('pkill', ['-9', '-f', profile], { stdio: 'ignore' });
  }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* 留在系統暫存資料夾 */ }
}
let browserPort;
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1); });
setTimeout(() => { console.error('測試逾時（90 秒）'); cleanup(); process.exit(1); }, 90_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    browserPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
    target = (await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json()).find((t) => t.type === 'page');
  } catch { await sleep(200); }
}
if (!target) throw new Error('無法連線到 headless 瀏覽器');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else events.push(msg);
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const errors = [];
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
setInterval(() => {
  while (events.length) {
    const e = events.shift();
    if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errors.push(JSON.stringify(e.params.args));
  }
}, 50);
const load = async () => { await sleep(600); };
const url = pathToFileURL(pageFile).href;
await send('Page.navigate', { url });
await load();
await ev(`localStorage.clear()`);
await send('Page.reload');
await load();

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// 頁面上的輔助函式
const H = `
  const $ = (id) => document.getElementById(id);
  const todayCol = () => document.querySelector('.day-col.today');
  const fill = (o) => { for (const [k, v] of Object.entries(o)) { const n = $(k); n.value = v; n.dispatchEvent(new Event('change')); } };
  const submit = () => $('bookingForm').requestSubmit();
  const err = () => $('formError').hidden ? '' : $('formError').textContent;
  const stored = () => JSON.parse(localStorage.getItem('meeting-room-board.bookings') || '[]');
  const clickSlot = (col, slot) => { const r = col.getBoundingClientRect(); col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 10, clientY: r.top + slot * 24 + 5 })); };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const selectedTab = () => document.querySelector('[aria-selected=true]').textContent;
`;

// AC1（目前時間線位置與預設捲動位置容許一格誤差）
let r = await ev(`${H} const n = new Date(), line = document.querySelector('.now-line');
  return { tab: selectedTab(), label: $('weekLabel').textContent, today: !!document.querySelector('.day-head.today'), now: !!line,
    nowTop: line && parseFloat(line.style.top), nowExp: (n.getHours() * 60 + n.getMinutes()) / 30 * 24, scroll: $('calendar').scrollTop };`);
check('AC1 預設 A 會議室、本週、今日與目前時間有標示', r.tab === 'A 會議室' && r.today && r.now && Math.abs(r.nowTop - r.nowExp) <= 24, JSON.stringify(r));
check('（補）預設捲動到 08:00 附近', Math.abs(r.scroll - 8 * 2 * 24) <= 24, `scrollTop=${r.scroll}`);

// 「新增預約」按鈕
r = await ev(`${H} $('newBooking').click();
  const o = { open: $('bookingDialog').open, title: $('dialogTitle').textContent, delHidden: $('deleteBtn').hidden, room: $('fRoom').value,
    date: $('fDate').value, today: ymd(new Date()), start: $('fStart').value, end: $('fEnd').value };
  $('bookingDialog').close(); return o;`);
check('（補）「新增預約」按鈕開啟空白表單', r.open && r.title === '新增預約' && r.delHidden && r.room === 'A' && r.date === r.today && r.start === '09:00' && r.end === '10:00', JSON.stringify(r));

// AC4
r = await ev(`${H} clickSlot(todayCol(), 18); const s = $('fStart').value, open = $('bookingDialog').open;
  fill({ fBooker: '王小明', fTitle: '週會' }); submit();
  const b = todayCol().querySelector('.booking'); return { s, open, closed: !$('bookingDialog').open, text: b && b.textContent, top: b && b.style.top };`);
check('AC4 點 09:00 空白格新增預約', r.open && r.s === '09:00' && r.closed && r.text?.includes('週會') && r.text?.includes('王小明') && r.top === '433px', JSON.stringify(r));

// AC5
r = await ev(`${H} clickSlot(todayCol(), 30); fill({ fBooker: '', fTitle: '' }); submit(); const e1 = err();
  fill({ fBooker: '甲', fTitle: '乙', fStart: '16:00', fEnd: '15:00' }); submit(); const e2 = err();
  fill({ fStart: '15:00', fEnd: '16:00', fDate: '' }); submit(); const e3 = err();
  $('bookingDialog').close(); return { e1, e2, e3, n: stored().length };`);
check('AC5 必填空白、結束 ≤ 開始 不可儲存', r.e1.includes('姓名') && r.e1.includes('主題') && r.e2.includes('結束時間') && r.n === 1, JSON.stringify(r));
check('（補）日期留空不可儲存', r.e3.includes('日期') && !r.e3.includes('結束時間') && r.n === 1, JSON.stringify(r.e3));

// AC6
r = await ev(`${H} clickSlot(todayCol(), 19); fill({ fEnd: '10:30', fBooker: '李四', fTitle: '衝突測試' }); submit();
  const e = err(); $('bookingDialog').close(); return { e, n: stored().length };`);
check('AC6 重疊時段被擋並提示衝突對象', r.e.includes('衝突') && r.e.includes('週會') && r.n === 1, JSON.stringify(r));

// AC7
r = await ev(`${H} clickSlot(todayCol(), 20); fill({ fEnd: '11:00', fBooker: '李四', fTitle: '接續會議' }); submit();
  return { e: err(), n: stored().length };`);
check('AC7 首尾相接可儲存', r.e === '' && r.n === 2, JSON.stringify(r));

// AC8 + AC2
r = await ev(`${H} clickSlot(todayCol(), 18); fill({ fRoom: 'B', fEnd: '10:00', fBooker: '張三', fTitle: 'B 室會議' }); submit();
  const tab = document.querySelector('[aria-selected=true]').textContent;
  const inB = [...document.querySelectorAll('.booking')].map((x) => x.textContent);
  document.querySelectorAll('#roomTabs button')[0].click();
  const inA = [...document.querySelectorAll('.booking')].map((x) => x.textContent);
  return { e: err(), n: stored().length, tab, inB, inA };`);
check('AC8 不同會議室同時段可儲存', r.e === '' && r.n === 3, JSON.stringify({ e: r.e, n: r.n }));
check('AC2 切換會議室只顯示該室預約', r.tab === 'B 會議室' && r.inB.length === 1 && r.inA.length === 2 && !r.inA.some((t) => t.includes('B 室')), JSON.stringify(r));

// AC3
r = await ev(`${H} const a = $('weekLabel').textContent; $('nextWeek').click(); const b = $('weekLabel').textContent;
  const cnt = document.querySelectorAll('.booking').length, today = !!document.querySelector('.day-head.today');
  $('prevWeek').click(); $('prevWeek').click(); const c = $('weekLabel').textContent; $('thisWeek').click();
  return { a, b, c, d: $('weekLabel').textContent, cnt, today };`);
check('AC3 上一週/下一週/回到本週', r.a !== r.b && r.b !== r.c && r.a === r.d && r.cnt === 0 && !r.today, JSON.stringify(r));

// AC9
r = await ev(`${H} todayCol().querySelector('.booking').click(); const title = $('dialogTitle').textContent, del = !$('deleteBtn').hidden;
  fill({ fTitle: '週會（改）', fAttendees: '5' }); submit();
  return { title, del, e: err(), s: stored().find((b) => b.title === '週會（改）') };`);
check('AC9 修改不更動時段可儲存', r.title === '修改預約' && r.del && r.e === '' && r.s?.attendees === 5 && r.s?.start === '09:00', JSON.stringify(r));

// 修改時改到衝突時段也要被擋
r = await ev(`${H} todayCol().querySelector('.booking').click(); fill({ fStart: '10:00', fEnd: '10:30' }); submit();
  const e = err(); $('bookingDialog').close(); return { e };`);
check('（補）修改成衝突時段會被擋', r.e.includes('接續會議'), JSON.stringify(r));

// 與會人數驗證
r = await ev(`${H} todayCol().querySelector('.booking').click(); fill({ fAttendees: '2.5' }); submit();
  const e = err(); $('bookingDialog').close(); return { e };`);
check('（補）與會人數須為正整數', r.e.includes('正整數'), JSON.stringify(r));

// 修改會議室與日期：看板跳到新位置，原位置不再顯示；結束後刪除，避免影響後續檢查
r = await ev(`${H} clickSlot(todayCol(), 36); fill({ fBooker: '王小明', fTitle: '搬移測試' }); submit();
  const find = () => [...document.querySelectorAll('.booking')].find((b) => b.textContent.includes('搬移測試'));
  find().click();
  const d = new Date(); d.setDate(d.getDate() + 7); const next = ymd(d);
  fill({ fRoom: 'C', fDate: next }); submit();
  const saved = stored().filter((b) => b.title === '搬移測試');
  const tabAfter = selectedTab(), label = $('weekLabel').textContent;
  const shown = !!document.querySelector('.day-col[data-date="' + next + '"]')?.textContent.includes('搬移測試');
  document.querySelectorAll('#roomTabs button')[0].click(); $('thisWeek').click();
  const leftover = !!find();
  document.querySelectorAll('#roomTabs button')[2].click(); $('nextWeek').click();
  window.confirm = () => true; find().click(); $('deleteBtn').click();
  document.querySelectorAll('#roomTabs button')[0].click(); $('thisWeek').click();
  return { e: err(), saved, next, tabAfter, label, shown, leftover, remain: stored().some((b) => b.title === '搬移測試') };`);
check('（補）修改會議室與日期後顯示在新位置', r.saved.length === 1 && r.saved[0].roomId === 'C' && r.saved[0].date === r.next
  && r.tabAfter === 'C 會議室' && r.shown && !r.leftover && !r.remain, JSON.stringify(r));

// AC12
r = await ev(`${H} clickSlot(todayCol(), 30); fill({ fEnd: '16:00', fBooker: '王小明', fTitle: '第二場' }); submit();
  const hues = [...todayCol().querySelectorAll('.booking')].map((b) => [b.textContent, b.style.getPropertyValue('--hue')]);
  return { hues };`);
{
  const wang = r.hues.filter(([t]) => t.includes('王小明')).map(([, h]) => h);
  const li = r.hues.find(([t]) => t.includes('李四'))[1];
  check('AC12 同名同色、不同名不同色', wang.length === 2 && wang[0] === wang[1] && li !== wang[0], JSON.stringify(r.hues));
}

// AC13
r = await ev(`${H} const opts = [...$('bookerFilter').options].map((o) => o.value); fill({ bookerFilter: '王小明' });
  const st = [...todayCol().querySelectorAll('.booking')].map((b) => [b.textContent.includes('王小明'), b.classList.contains('dimmed')]);
  return { opts, st };`);
check('AC13 篩選選單為「全部」加上所有姓名', r.opts[0] === '' && r.opts.slice(1).sort().join() === ['張三', '李四', '王小明'].sort().join(), JSON.stringify(r.opts));
check('AC13 淡化規則正確', r.st.length === 3 && r.st.every(([mine, dim]) => mine !== dim), JSON.stringify(r.st));

// 預約明細（此時篩選為王小明）：只列本週、本會議室，依時間排序，篩選時淡化，點選可開啟修改
r = await ev(`${H} const rows = () => [...document.querySelectorAll('#detailsBody tr[data-id]')];
  const a = rows().map((tr) => [tr.cells[1].textContent, tr.cells[2].textContent, tr.cells[3].textContent, tr.classList.contains('dimmed')]);
  const count = $('detailsCount').textContent;
  rows()[1].querySelector('.link').click();
  const dlg = $('bookingDialog').open && $('dialogTitle').textContent, editTitle = $('fTitle').value; $('bookingDialog').close();
  document.querySelectorAll('#roomTabs button')[1].click(); const inB = rows().map((tr) => tr.cells[2].textContent);
  document.querySelectorAll('#roomTabs button')[0].click();
  $('nextWeek').click(); const empty = $('detailsBody').textContent; $('thisWeek').click();
  return { a, count, dlg, editTitle, inB, empty };`);
check('（補）預約明細：本週本會議室、依時間排序、篩選淡化', JSON.stringify(r.a) === JSON.stringify([
  ['09:00–10:00', '週會（改）', '王小明', false], ['10:00–11:00', '接續會議', '李四', true], ['15:00–16:00', '第二場', '王小明', false]])
  && r.count.includes('共 3 筆') && r.count.includes('王小明 2 筆'), JSON.stringify({ a: r.a, count: r.count }));
check('（補）預約明細：點選開啟修改、切換會議室與週會更新', r.dlg === '修改預約' && r.editTitle === '接續會議'
  && JSON.stringify(r.inB) === '["B 室會議"]' && r.empty.includes('這週沒有預約'), JSON.stringify({ dlg: r.dlg, editTitle: r.editTitle, inB: r.inB, empty: r.empty }));
await send('Page.captureScreenshot', { format: 'png' }).then((x) => writeFileSync(join(outDir, 'board.png'), Buffer.from(x.result.data, 'base64')));
await ev(`${H} fill({ bookerFilter: '' });`);

// 對話框截圖
await ev(`${H} clickSlot(todayCol(), 19); fill({ fEnd: '10:30', fBooker: '李四', fTitle: '衝突測試' }); submit();`);
await send('Page.captureScreenshot', { format: 'png' }).then((x) => writeFileSync(join(outDir, 'dialog.png'), Buffer.from(x.result.data, 'base64')));
await ev(`document.getElementById('bookingDialog').close();`);

// AC10
r = await ev(`${H} const before = stored().length; todayCol().querySelector('.booking').click();
  window.confirm = () => false; $('deleteBtn').click(); const kept = stored().length, stillOpen = $('bookingDialog').open;
  window.confirm = () => true; $('deleteBtn').click(); return { before, kept, stillOpen, after: stored().length, closed: !$('bookingDialog').open };`);
check('AC10 刪除：取消保留、確定刪除', r.kept === r.before && r.after === r.before - 1 && r.closed, JSON.stringify(r));

// localStorage 寫入失敗（例如容量已滿）：顯示錯誤、對話框不關閉、資料不變
r = await ev(`${H} const before = JSON.stringify(stored()); const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  try {
    clickSlot(todayCol(), 40); fill({ fBooker: '王小明', fTitle: '寫入失敗' }); submit();
    const e1 = err(), open1 = $('bookingDialog').open; $('bookingDialog').close();
    const shown = [...document.querySelectorAll('.booking')].some((b) => b.textContent.includes('寫入失敗'));
    todayCol().querySelector('.booking').click(); window.confirm = () => true; $('deleteBtn').click();
    const e2 = err(), open2 = $('bookingDialog').open; $('bookingDialog').close();
    return { e1, open1, shown, e2, open2, same: JSON.stringify(stored()) === before, n: todayCol().querySelectorAll('.booking').length };
  } finally { Storage.prototype.setItem = orig; }`);
check('（補）localStorage 寫入失敗時顯示錯誤且資料不變', r.e1.includes('未儲存') && r.open1 && !r.shown && r.e2.includes('未刪除') && r.open2 && r.same, JSON.stringify(r));

// AC11
const countBefore = await ev(`return document.querySelectorAll('.booking').length;`);
await send('Page.reload'); await load();
r = await ev(`return { n: document.querySelectorAll('.booking').length };`);
check('AC11 重新整理後資料仍在', r.n === countBefore && r.n > 0, `before=${countBefore} after=${r.n}`);

// AC14
await ev(`localStorage.setItem('meeting-room-board.bookings', '{not json');`);
await send('Page.reload'); await load();
r = await ev(`return { cols: document.querySelectorAll('.day-col').length, n: document.querySelectorAll('.booking').length, tabs: document.querySelectorAll('#roomTabs button').length };`);
check('AC14 資料損毀時以空看板啟動', r.cols === 7 && r.n === 0 && r.tabs === 3, JSON.stringify(r));

// 部分損毀：只濾掉不合格的筆數，正常的保留
await ev(`${H} const ok = { id: 'ok', roomId: 'A', date: ymd(new Date()), start: '09:00', end: '10:00', booker: '甲', title: '正常' };
  localStorage.setItem('meeting-room-board.bookings', JSON.stringify([ok,
    { ...ok, id: 'x1', roomId: 'Z', title: '無效會議室' }, { ...ok, id: 'x2', start: '11:00', title: '時間倒置' },
    { ...ok, id: 'x3', booker: '  ', title: '無姓名' }, { ...ok, id: 'x4', end: '24:30', title: '超過午夜' },
    { ...ok, id: 'x5', date: '2026/10/20', title: '日期格式錯誤' }, null, 'str', 42]));`);
await send('Page.reload'); await load();
r = await ev(`return [...document.querySelectorAll('.booking .b-title')].map((x) => x.textContent);`);
check('（補）部分資料損毀時只濾掉無效筆數', r.length === 1 && r[0] === '正常', JSON.stringify(r));

// 跨週：以假時鐘把時間設在本週日 23:59，再往後推 2 分鐘並手動觸發 setInterval
const fakeClock = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const RealDate = Date;
  const n = new RealDate();
  let offset = new RealDate(n.getFullYear(), n.getMonth(), n.getDate() + (7 - n.getDay()) % 7, 23, 59).getTime() - RealDate.now();
  window.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  };
  window.__advance = (ms) => { offset += ms; };
  const realSetInterval = window.setInterval;
  window.__intervals = [];
  window.setInterval = (fn, ms, ...rest) => { window.__intervals.push(fn); return realSetInterval(fn, ms, ...rest); };
})();` });
const W = `const $ = (id) => document.getElementById(id);
  const todayIdx = () => [...document.querySelectorAll('.day-head')].findIndex((h) => h.classList.contains('today'));
  const tick = () => { window.__advance(2 * 60 * 1000); window.__intervals.forEach((f) => f()); };`;
await send('Page.reload'); await load();
r = await ev(`${W} const a = $('weekLabel').textContent, i0 = todayIdx(); tick();
  return { a, i0, b: $('weekLabel').textContent, i1: todayIdx(), now: !!document.querySelector('.now-line') };`);
check('（補）跨週時若正在看本週，自動切到新的一週', r.i0 === 6 && r.a !== r.b && r.i1 === 0 && r.now, JSON.stringify(r));
await send('Page.reload'); await load();
r = await ev(`${W} $('prevWeek').click(); const a = $('weekLabel').textContent; tick();
  return { a, b: $('weekLabel').textContent, i1: todayIdx() };`);
check('（補）跨週時若正在看其他週，維持原本的週', r.a === r.b && r.i1 === -1, JSON.stringify(r));
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fakeClock.result.identifier });
await send('Page.reload'); await load();

// 手機寬度：無橫向捲動頁面
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
await sleep(300);
r = await ev(`return { doc: document.documentElement.scrollWidth, vw: window.innerWidth };`);
check('（補）手機寬度頁面不橫向溢出', r.doc <= r.vw, JSON.stringify(r));
await send('Page.captureScreenshot', { format: 'png' }).then((x) => writeFileSync(join(outDir, 'mobile.png'), Buffer.from(x.result.data, 'base64')));

await sleep(200);
check('頁面無 JS 錯誤', errors.length === 0, errors.join(' | '));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(`截圖：${outDir}`);
ws.close();
await closeBrowser();
cleanup();
process.exit(failed ? 1 : 0);

// 透過瀏覽器層級的 CDP 連線送出 Browser.close，讓 Chrome 自行結束所有子行程
async function closeBrowser() {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${browserPort}/json/version`)).json();
    const bws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r, j) => { bws.addEventListener('open', r); bws.addEventListener('error', j); });
    bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    for (let i = 0; i < 25 && existsSync(join(profile, 'lockfile')); i++) await sleep(200);
  } catch { /* 交給 cleanup() 強制結束 */ }
}
