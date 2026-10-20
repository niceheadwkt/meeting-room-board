(() => {
  'use strict';

  // ---- 設定 ----
  const ROOMS = [
    { id: 'A', name: 'A 會議室' },
    { id: 'B', name: 'B 會議室' },
    { id: 'C', name: 'C 會議室' },
  ];
  const STORAGE_KEY = 'meeting-room-board.bookings';
  const SLOT_MIN = 30;
  const SLOT_PX = 24; // 需與 style.css 的 --slot 一致
  const DAY_MIN = 24 * 60;
  const DEFAULT_SCROLL_HOUR = 8;
  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

  // ---- 日期與時間工具 ----
  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  // 一週從週一開始
  const startOfWeek = (d) => {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return addDays(r, -((r.getDay() + 6) % 7));
  };
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  // ---- 資料存取 ----
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;

  function isValidBooking(b) {
    return b && typeof b === 'object'
      && typeof b.id === 'string'
      && ROOMS.some((r) => r.id === b.roomId)
      && typeof b.date === 'string' && DATE_RE.test(b.date)
      && typeof b.start === 'string' && TIME_RE.test(b.start)
      && typeof b.end === 'string' && TIME_RE.test(b.end)
      && toMin(b.start) < toMin(b.end) && toMin(b.end) <= DAY_MIN
      && typeof b.booker === 'string' && b.booker.trim() !== ''
      && typeof b.title === 'string' && b.title.trim() !== '';
  }

  function loadBookings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter(isValidBooking) : [];
    } catch {
      return [];
    }
  }

  function saveBookings(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  const newId = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

  // 首尾相接不算重疊；修改時排除自己
  function findConflict(list, c) {
    const s = toMin(c.start);
    const e = toMin(c.end);
    return list.find((b) => b.id !== c.id
      && b.roomId === c.roomId
      && b.date === c.date
      && toMin(b.start) < e && s < toMin(b.end));
  }

  // 依姓名決定色相，同一人固定同色
  function hueFor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return (h * 137) % 360;
  }

  // ---- 狀態 ----
  const state = {
    bookings: loadBookings(),
    roomId: ROOMS[0].id,
    weekStart: startOfWeek(new Date()),
    filter: '',
    editingId: null,
  };

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const calendar = $('calendar');
  const calGrid = $('calGrid');
  const roomTabs = $('roomTabs');
  const weekLabel = $('weekLabel');
  const bookerFilter = $('bookerFilter');
  const dialog = $('bookingDialog');
  const form = $('bookingForm');
  const formError = $('formError');
  const fRoom = $('fRoom');
  const fDate = $('fDate');
  const fStart = $('fStart');
  const fEnd = $('fEnd');
  const fBooker = $('fBooker');
  const fTitle = $('fTitle');
  const fAttendees = $('fAttendees');
  const fNote = $('fNote');
  const bookerList = $('bookerList');
  const deleteBtn = $('deleteBtn');
  const detailsBody = $('detailsBody');
  const detailsCount = $('detailsCount');
  const exportDate = $('exportDate');

  // ---- 繪製 ----
  function bookerNames() {
    return [...new Set(state.bookings.map((b) => b.booker))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  function renderRoomTabs() {
    roomTabs.replaceChildren(...ROOMS.map((room) => {
      const btn = el('button', null, room.name);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(room.id === state.roomId));
      btn.addEventListener('click', () => {
        state.roomId = room.id;
        render();
      });
      return btn;
    }));
  }

  function renderFilter() {
    const names = bookerNames();
    if (state.filter && !names.includes(state.filter)) state.filter = '';
    const all = el('option', null, '全部');
    all.value = '';
    bookerFilter.replaceChildren(all, ...names.map((n) => {
      const o = el('option', null, n);
      o.value = n;
      return o;
    }));
    bookerFilter.value = state.filter;
    bookerList.replaceChildren(...names.map((n) => {
      const o = el('option');
      o.value = n;
      return o;
    }));
  }

  function renderWeekLabel() {
    const s = state.weekStart;
    const e = addDays(s, 6);
    const sameYear = s.getFullYear() === e.getFullYear();
    weekLabel.textContent = `${s.getFullYear()}/${s.getMonth() + 1}/${s.getDate()} – `
      + `${sameYear ? '' : `${e.getFullYear()}/`}${e.getMonth() + 1}/${e.getDate()}`;
  }

  function renderBooking(b) {
    const s = toMin(b.start);
    const e = toMin(b.end);
    const block = el('button', 'booking');
    block.type = 'button';
    block.style.setProperty('--hue', hueFor(b.booker));
    block.style.top = `${(s / SLOT_MIN) * SLOT_PX + 1}px`;
    block.style.height = `${((e - s) / SLOT_MIN) * SLOT_PX - 2}px`;
    if (state.filter && b.booker !== state.filter) block.classList.add('dimmed');
    block.title = `${b.title}\n${b.booker}\n${b.start}–${b.end}`
      + (b.attendees ? `\n${b.attendees} 人` : '')
      + (b.note ? `\n${b.note}` : '');
    block.append(
      el('span', 'b-title', b.title),
      el('span', 'b-meta', `${b.booker}・${b.start}–${b.end}`),
    );
    block.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openForm(b);
    });
    return block;
  }

  function renderGrid() {
    const today = toDateStr(new Date());
    const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
    const nodes = [el('div', 'corner')];

    days.forEach((d, i) => {
      const head = el('div', 'day-head');
      if (toDateStr(d) === today) head.classList.add('today');
      head.append(el('span', 'dow', `週${WEEKDAYS[i]}`), el('span', 'dom', `${d.getMonth() + 1}/${d.getDate()}`));
      nodes.push(head);
    });

    const timeCol = el('div', 'time-col');
    for (let h = 0; h < 24; h++) {
      const label = el('span', null, `${pad(h)}:00`);
      label.style.top = `${h * (60 / SLOT_MIN) * SLOT_PX}px`;
      timeCol.append(label);
    }
    nodes.push(timeCol);

    const roomBookings = state.bookings.filter((b) => b.roomId === state.roomId);
    days.forEach((d) => {
      const dateStr = toDateStr(d);
      const col = el('div', 'day-col');
      col.dataset.date = dateStr;
      if (dateStr === today) {
        col.classList.add('today');
        const now = new Date();
        const line = el('div', 'now-line');
        line.style.top = `${((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN) * SLOT_PX}px`;
        col.append(line);
      }
      roomBookings
        .filter((b) => b.date === dateStr)
        .forEach((b) => col.append(renderBooking(b)));
      nodes.push(col);
    });

    calGrid.replaceChildren(...nodes);
  }

  // 看板下方的明細：所選會議室、目前這一週，依日期與開始時間排序
  function renderDetails() {
    const from = toDateStr(state.weekStart);
    const to = toDateStr(addDays(state.weekStart, 6));
    const list = state.bookings
      .filter((b) => b.roomId === state.roomId && b.date >= from && b.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    const room = ROOMS.find((r) => r.id === state.roomId);
    detailsCount.textContent = `${room.name}・共 ${list.length} 筆`
      + (state.filter ? `（${state.filter} ${list.filter((b) => b.booker === state.filter).length} 筆）` : '');

    if (!list.length) {
      const td = el('td', 'empty', '這週沒有預約。');
      td.colSpan = 6;
      const tr = el('tr');
      tr.append(td);
      detailsBody.replaceChildren(tr);
      return;
    }

    detailsBody.replaceChildren(...list.map((b) => {
      const d = parseDate(b.date);
      const tr = el('tr');
      tr.dataset.id = b.id;
      if (state.filter && b.booker !== state.filter) tr.classList.add('dimmed');

      const titleBtn = el('button', 'link', b.title);
      titleBtn.type = 'button';
      const titleCell = el('td');
      titleCell.append(titleBtn);
      const dot = el('span', 'dot');
      dot.style.setProperty('--hue', hueFor(b.booker));
      const bookerCell = el('td');
      bookerCell.append(dot, b.booker);
      const noteCell = el('td', 'note', b.note || '');
      noteCell.title = b.note || '';

      tr.append(
        el('td', null, `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[(d.getDay() + 6) % 7]}）`),
        el('td', null, `${b.start}–${b.end}`),
        titleCell,
        bookerCell,
        el('td', null, b.attendees ? String(b.attendees) : '—'),
        noteCell,
      );
      // 主題按鈕的點擊會冒泡到這裡，鍵盤操作也走同一條路
      tr.addEventListener('click', () => openForm(b));
      return tr;
    }));
  }

  function render() {
    renderRoomTabs();
    renderWeekLabel();
    renderFilter();
    renderGrid();
    renderDetails();
  }

  // ---- 表單 ----
  function fillTimeOptions() {
    fRoom.replaceChildren(...ROOMS.map((r) => {
      const o = el('option', null, r.name);
      o.value = r.id;
      return o;
    }));
    const startOpts = [];
    const endOpts = [];
    for (let m = 0; m < DAY_MIN; m += SLOT_MIN) {
      const o = el('option', null, toTime(m));
      o.value = toTime(m);
      startOpts.push(o);
    }
    for (let m = SLOT_MIN; m <= DAY_MIN; m += SLOT_MIN) {
      const o = el('option', null, toTime(m));
      o.value = toTime(m);
      endOpts.push(o);
    }
    fStart.replaceChildren(...startOpts);
    fEnd.replaceChildren(...endOpts);
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  // booking 為既有預約（修改），或 { date, start } 預填值（新增）
  function openForm(booking) {
    const editing = booking && booking.id;
    state.editingId = editing ? booking.id : null;
    $('dialogTitle').textContent = editing ? '修改預約' : '新增預約';
    deleteBtn.hidden = !editing;
    showError('');

    const startMin = booking && booking.start ? toMin(booking.start) : 9 * 60;
    const endMin = editing ? toMin(booking.end) : Math.min(startMin + 60, DAY_MIN);

    fRoom.value = editing ? booking.roomId : state.roomId;
    fDate.value = (booking && booking.date) || toDateStr(new Date());
    fStart.value = toTime(startMin);
    fEnd.value = toTime(endMin);
    fBooker.value = editing ? booking.booker : '';
    fTitle.value = editing ? booking.title : '';
    fAttendees.value = editing && booking.attendees ? booking.attendees : '';
    fNote.value = editing ? booking.note || '' : '';

    dialog.showModal();
    (editing ? fTitle : fBooker).focus();
  }

  function readForm() {
    const attendeesRaw = fAttendees.value.trim();
    return {
      id: state.editingId || newId(),
      roomId: fRoom.value,
      date: fDate.value,
      start: fStart.value,
      end: fEnd.value,
      booker: fBooker.value.trim(),
      title: fTitle.value.trim(),
      attendees: attendeesRaw === '' ? null : Number(attendeesRaw),
      note: fNote.value.trim(),
    };
  }

  function validate(b) {
    const errors = [];
    if (!DATE_RE.test(b.date)) errors.push('請選擇日期。');
    if (toMin(b.end) <= toMin(b.start)) errors.push('結束時間必須晚於開始時間。');
    if (!b.booker) errors.push('請填寫預約人姓名。');
    if (!b.title) errors.push('請填寫會議主題。');
    if (b.attendees !== null && !(Number.isInteger(b.attendees) && b.attendees >= 1)) {
      errors.push('與會人數須為正整數。');
    }
    if (fAttendees.validity.badInput) errors.push('與會人數須為正整數。');
    return [...new Set(errors)];
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const b = readForm();
    const errors = validate(b);
    if (errors.length) {
      showError(errors.join('\n'));
      return;
    }
    const conflict = findConflict(state.bookings, b);
    if (conflict) {
      showError(`此時段與既有預約衝突：\n「${conflict.title}」（${conflict.booker}，${conflict.date} ${conflict.start}–${conflict.end}）`);
      return;
    }

    const next = state.editingId
      ? state.bookings.map((x) => (x.id === b.id ? b : x))
      : [...state.bookings, b];
    if (!saveBookings(next)) {
      showError('無法寫入瀏覽器儲存空間，預約未儲存。');
      return;
    }
    state.bookings = next;
    // 跳到剛儲存的預約所在的會議室與週
    state.roomId = b.roomId;
    state.weekStart = startOfWeek(parseDate(b.date));
    dialog.close();
    render();
  }

  function onDelete() {
    const target = state.bookings.find((x) => x.id === state.editingId);
    if (!target) return;
    if (!confirm(`確定要刪除「${target.title}」（${target.date} ${target.start}–${target.end}）嗎？`)) return;
    const next = state.bookings.filter((x) => x.id !== target.id);
    if (!saveBookings(next)) {
      showError('無法寫入瀏覽器儲存空間，預約未刪除。');
      return;
    }
    state.bookings = next;
    dialog.close();
    render();
  }

  // ---- 匯出 ----
  // 含逗號、引號或換行時加上引號；開頭為 = + - @ 時前置單引號，避免試算表當成公式執行
  const csvCell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // 匯出選定日期所有會議室的預約，依會議室順序與開始時間排序；不受預約人篩選影響
  function exportCsv() {
    const date = exportDate.value;
    if (!date) {
      exportDate.focus();
      return;
    }
    const order = (id) => ROOMS.findIndex((r) => r.id === id);
    const rows = state.bookings
      .filter((b) => b.date === date)
      .sort((a, b) => order(a.roomId) - order(b.roomId) || a.start.localeCompare(b.start))
      .map((b) => [ROOMS[order(b.roomId)].name, b.date, `${b.start}–${b.end}`, b.booker]);
    const csv = [['會議室', '日期', '時段', '預約人'], ...rows]
      .map((r) => r.map(csvCell).join(',')).join('\r\n');
    // 加上 BOM，Excel 才會以 UTF-8 開啟
    const url = URL.createObjectURL(new Blob(['﻿', csv, '\r\n'], { type: 'text/csv;charset=utf-8' }));
    const a = el('a');
    a.href = url;
    a.download = `會議室預約_${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- 事件 ----
  $('prevWeek').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, -7);
    render();
  });
  $('nextWeek').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, 7);
    render();
  });
  $('thisWeek').addEventListener('click', () => {
    state.weekStart = startOfWeek(new Date());
    render();
  });
  $('newBooking').addEventListener('click', () => openForm(null));
  $('exportCsv').addEventListener('click', exportCsv);
  bookerFilter.addEventListener('change', () => {
    state.filter = bookerFilter.value;
    renderGrid();
    renderDetails();
  });

  // 點擊空白格子：依點擊位置帶入日期與開始時間
  calGrid.addEventListener('click', (ev) => {
    const col = ev.target.closest('.day-col');
    if (!col || ev.target.closest('.booking')) return;
    const y = ev.clientY - col.getBoundingClientRect().top;
    const slot = Math.max(0, Math.min(DAY_MIN / SLOT_MIN - 1, Math.floor(y / SLOT_PX)));
    openForm({ date: col.dataset.date, start: toTime(slot * SLOT_MIN) });
  });

  fStart.addEventListener('change', () => {
    const s = toMin(fStart.value);
    if (toMin(fEnd.value) <= s) fEnd.value = toTime(Math.min(s + 60, DAY_MIN));
  });
  form.addEventListener('submit', onSubmit);
  deleteBtn.addEventListener('click', onDelete);
  $('cancelBtn').addEventListener('click', () => dialog.close());

  // 每分鐘更新目前時間線與今日標示；跨週時若正在看本週，跟著切到新的一週
  let currentWeek = startOfWeek(new Date());
  setInterval(() => {
    const week = startOfWeek(new Date());
    if (week.getTime() === currentWeek.getTime()) {
      renderGrid();
      return;
    }
    if (state.weekStart.getTime() === currentWeek.getTime()) state.weekStart = week;
    currentWeek = week;
    render();
  }, 60 * 1000);

  // ---- 啟動 ----
  fillTimeOptions();
  exportDate.value = toDateStr(new Date());
  render();
  // 留半格空間，避免整點標籤被固定的表頭遮住
  calendar.scrollTop = DEFAULT_SCROLL_HOUR * (60 / SLOT_MIN) * SLOT_PX - SLOT_PX / 2;
})();
