'use strict';

const $ = selector => document.querySelector(selector);
const cloudMode = !['localhost', '127.0.0.1', ''].includes(location.hostname);
let cloudAdapter = null;
let cloudReady = null;
let cloudConnected = false;
function showAuth(message) {
  $('.app-shell').hidden = true;
  $('#auth-gate').hidden = false;
  $('#auth-message').textContent = message || 'Войди, чтобы открыть свои тренировки на любом устройстве.';
}
async function apiRequest(path, options = {}) {
  if (!cloudMode) return fetch(path, { ...options, cache: 'no-store' });
  await cloudReady;
  if (!cloudAdapter) throw new Error('Не удалось подключить Firebase. Обнови страницу.');
  const result = options.method === 'PUT' ? await cloudAdapter.save(JSON.parse(options.body)) : { status: 200, state: await cloudAdapter.load() };
  return { ok: result.status === 200, status: result.status, json: async () => result.status === 200 ? result.state : result };
}
function storageStatus() {
  const label = cloudMode ? (cloudConnected ? 'Синхронизировано' : 'Нет связи с хранилищем') : 'Локальное хранение';
  $('#save-status').innerHTML = '<i></i> ' + label;
  if ($('#cloud-footer-status')) $('#cloud-footer-status').textContent = label;
}
async function startCloud() {
  showAuth('Подключаем дневник…');
  const module = await import('./firebase-cloud.js?v=12ff59704b25');
  cloudAdapter = await module.connect(window.RITM_CONFIG.firebase, {
    onSession(user) {
      if (user) { $('#login-password').value = ''; load(); }
      else {
        loaded = false;
        state = { revision: 0, types: BASE_TYPES, workouts: [] };
        document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
        render();
        showAuth();
      }
    },
    onData(next) {
      if (!loaded || busy) return;
      if (document.querySelector('dialog[open]')) return;
      state = next; render(); storageStatus();
    },
    onError() { if (loaded) toast('Связь с хранилищем прервалась. Проверь интернет.'); },
    onConnection(connected) { cloudConnected = connected; if (!busy) storageStatus(); }
  });
}
const ICONS = {
  push: '<circle cx="7" cy="9" r="2.3"/><path d="m10 11 10 4 6 1M12 12l-2 8H6m13-5 4 5h5M3 24h26"/>',
  pull: '<path d="M3 4h26M7 4v8l5 5m13-13v8l-5 5M12 15v8l-3 6m11-14v8l3 6M12 17h8"/><circle cx="16" cy="11" r="3"/>',
  walk: '<circle cx="18" cy="5" r="2.5"/><path d="m16 10-4 7 5 4-2 8m0-17 5 5h5m-10 1-5 5-5 3m8-13-5 4H4"/>'
};
const BASE_TYPES = [
  { id: 'push-ups', name: 'Отжимания от пола', icon: 'push' },
  { id: 'pull-ups', name: 'Подтягивания на турнике', icon: 'pull' },
  { id: 'walking', name: 'Ходьба', icon: 'walk' }
];
let state = { revision: 0, types: BASE_TYPES, workouts: [] };
let loaded = false;
let busy = false;
let editingId = null;
let deletingId = null;
let toastTimer;
const now = new Date();
let selectedDate = dateKey(now);
let viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
let calendarStart = null;
let calendarEnd = null;
let calendarTarget = 0;
let calendarAnimation = 0;
let calendarScrollFrame = 0;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function currentTime() { const time = new Date(); return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`; }
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function plural(count, words) { const last = count % 10; const tens = count % 100; return words[tens >= 11 && tens <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]; }
function noteTotal(note) {
  const parts = note.trim().split(',').map(part => part.trim());
  if (!parts.every(part => /^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.every(Number.isSafeInteger) && Number.isSafeInteger(total) ? total : null;
}
function formatTotal(total) { return total.toLocaleString('ru-RU'); }
function updateNotePreview() {
  const note = $('#workout-note').value;
  const total = noteTotal(note);
  $('#note-count').textContent = note.length;
  $('#note-total-preview').hidden = total === null;
  $('#note-total-preview').textContent = total === null ? '' : `Всего: ${formatTotal(total)}`;
}
function icon(type, label = true) { return `<span class="exercise-icon ${type.icon}"${label ? ` role="img" aria-label="${escapeHTML(type.name)}" title="${escapeHTML(type.name)}"` : ' aria-hidden="true"'}><svg viewBox="0 0 32 32" aria-hidden="true">${ICONS[type.icon]}</svg></span>`; }
function typeFor(workout) { return state.types.find(type => type.id === workout.typeId); }
function workoutsOn(key) { return state.workouts.filter(workout => workout.date === key).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')); }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000); }

function render() {
  $('#type-list').innerHTML = state.types.map(type => `<div class="type-item">${icon(type)}<span>${escapeHTML(type.name)}</span></div>`).join('');
  renderCalendar();
  renderDay();
  renderStats();
}
function shiftDays(date, amount) { const shifted = new Date(date); shifted.setDate(shifted.getDate() + amount); return shifted; }
function setCalendarRange(date) {
  calendarStart = new Date(date.getFullYear(), date.getMonth() - 3, 1);
  calendarStart = shiftDays(calendarStart, -(calendarStart.getDay() + 6) % 7);
  calendarEnd = new Date(date.getFullYear(), date.getMonth() + 4, 0);
  calendarEnd = shiftDays(calendarEnd, (7 - calendarEnd.getDay()) % 7);
}
function calendarDaysHTML(start, end) {
  const todayKey = dateKey(new Date());
  let html = '';
  for (let date = new Date(start); date <= end; date = shiftDays(date, 1)) {
    const key = dateKey(date);
    const workouts = workoutsOn(key);
    const uniqueTypes = [...new Set(workouts.map(workout => workout.typeId))].map(id => state.types.find(type => type.id === id));
    const classes = ['calendar-day', date.getDate() === 1 ? 'month-start' : '', key === selectedDate ? 'selected' : '', key === todayKey ? 'today' : ''].filter(Boolean).join(' ');
    const description = `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}${workouts.length ? `, ${workouts.length} ${plural(workouts.length, ['тренировка', 'тренировки', 'тренировок'])}: ${uniqueTypes.map(type => type.name).join(', ')}` : ', без тренировок'}`;
    const monthLabel = date.getDate() === 1 ? `<span class="day-month" aria-hidden="true">${date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</span>` : '';
    html += `<button class="${classes}" data-date="${key}" aria-label="${escapeHTML(description)}" aria-pressed="${key === selectedDate}"${key === todayKey ? ' aria-current="date"' : ''}><span class="day-number">${date.getDate()}</span>${monthLabel}<span class="day-hover-plus" aria-hidden="true">+</span><span class="day-icons">${uniqueTypes.slice(0, 3).map(type => icon(type)).join('')}${uniqueTypes.length > 3 ? `<span class="more-count">+${uniqueTypes.length - 3}</span>` : ''}</span></button>`;
  }
  return html;
}
function renderCalendar() {
  const scroller = $('#calendar-scroll');
  const firstRender = calendarStart === null;
  const previousTop = scroller.scrollTop;
  if (firstRender) setCalendarRange(viewDate);
  $('#calendar-grid').innerHTML = calendarDaysHTML(calendarStart, calendarEnd);
  scroller.scrollTop = firstRender ? dateScrollOffset(viewDate) : previousTop;
  if (!calendarAnimation) calendarTarget = scroller.scrollTop;
  updateCalendarHeading();
}
function dateScrollOffset(date) {
  const cell = $(`#calendar-grid [data-date="${dateKey(date)}"]`);
  if (!cell) return 0;
  const scroller = $('#calendar-scroll');
  return scroller.scrollTop + cell.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}
function updateCalendarHeading() {
  const scroller = $('#calendar-scroll');
  const grid = $('#calendar-grid');
  const firstCell = grid.firstElementChild;
  if (!firstCell) return;
  const rowHeight = firstCell.getBoundingClientRect().height + parseFloat(getComputedStyle(grid).rowGap);
  const sampleOffset = Math.min(scroller.clientHeight * .3, rowHeight + 2);
  const row = Math.max(0, Math.floor((scroller.getBoundingClientRect().top + sampleOffset - firstCell.getBoundingClientRect().top) / rowHeight));
  // Use a visible week just below the edge, so partial boundary weeks do not
  // leave the heading on the previous month after navigating to the first.
  const cell = grid.children[Math.min(grid.children.length - 1, row * 7 + 3)];
  const date = parseDate(cell.dataset.date);
  const changed = date.getMonth() !== viewDate.getMonth() || date.getFullYear() !== viewDate.getFullYear();
  viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
  $('#month-title').textContent = capitalize(viewDate.toLocaleDateString('ru-RU', { month: 'long' }));
  $('#month-year').textContent = viewDate.getFullYear();
  if (changed) renderStats();
}
function growCalendar() {
  const scroller = $('#calendar-scroll');
  const grid = $('#calendar-grid');
  if (scroller.scrollTop < 650) {
    const newStart = shiftDays(calendarStart, -42);
    const oldHeight = scroller.scrollHeight;
    const oldTop = scroller.scrollTop;
    grid.insertAdjacentHTML('afterbegin', calendarDaysHTML(newStart, shiftDays(calendarStart, -1)));
    calendarStart = newStart;
    const addedHeight = scroller.scrollHeight - oldHeight;
    // Preserve the exact visible pixel when earlier weeks are prepended.
    scroller.scrollTop = oldTop + addedHeight;
    calendarTarget += addedHeight;
  }
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 650) {
    const newEnd = shiftDays(calendarEnd, 42);
    grid.insertAdjacentHTML('beforeend', calendarDaysHTML(shiftDays(calendarEnd, 1), newEnd));
    calendarEnd = newEnd;
  }
}
function stopCalendarAnimation() {
  cancelAnimationFrame(calendarAnimation);
  calendarAnimation = 0;
  calendarTarget = $('#calendar-scroll').scrollTop;
}
function glideCalendarTo(top) {
  const scroller = $('#calendar-scroll');
  calendarTarget = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
  if (reducedMotion.matches) { scroller.scrollTop = calendarTarget; return; }
  if (calendarAnimation) return;
  let previousTime = performance.now();
  function animate(time) {
    const elapsed = Math.min(64, Math.max(1, time - previousTime));
    previousTime = time;
    const distance = calendarTarget - scroller.scrollTop;
    if (Math.abs(distance) <= .75) {
      scroller.scrollTop = calendarTarget;
      calendarAnimation = 0;
      return;
    }
    // Keep the final steps moving on browsers that round scrollTop to pixels.
    const step = Math.sign(distance) * Math.min(Math.abs(distance), Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 80))));
    scroller.scrollTop += step;
    calendarAnimation = requestAnimationFrame(animate);
  }
  calendarAnimation = requestAnimationFrame(animate);
}
function scrollCalendarToDate(date, smooth = true) {
  stopCalendarAnimation();
  if (date < calendarStart || date > calendarEnd) {
    setCalendarRange(date);
    $('#calendar-grid').innerHTML = calendarDaysHTML(calendarStart, calendarEnd);
  }
  const top = dateScrollOffset(date);
  if (smooth) glideCalendarTo(top);
  else { $('#calendar-scroll').scrollTop = top; calendarTarget = $('#calendar-scroll').scrollTop; }
  updateCalendarHeading();
}
function updateSelectedCalendarDay() {
  document.querySelectorAll('#calendar-grid .selected').forEach(cell => { cell.classList.remove('selected'); cell.setAttribute('aria-pressed', 'false'); });
  const cell = $(`#calendar-grid [data-date="${selectedDate}"]`);
  if (cell) { cell.classList.add('selected'); cell.setAttribute('aria-pressed', 'true'); }
}
function renderDay() {
  const date = parseDate(selectedDate);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  $('#selected-relative').textContent = selectedDate === dateKey(today) ? 'СЕГОДНЯ' : selectedDate === dateKey(yesterday) ? 'ВЧЕРА' : selectedDate === dateKey(tomorrow) ? 'ЗАВТРА' : 'ВЫБРАННЫЙ ДЕНЬ';
  $('#selected-title').textContent = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  $('#selected-weekday').textContent = capitalize(date.toLocaleDateString('ru-RU', { weekday: 'long' }));
  if (!loaded) { $('#day-content').innerHTML = '<div class="loading-day">Загружаем твой дневник…</div>'; return; }
  const workouts = workoutsOn(selectedDate);
  if (!workouts.length) {
    $('#day-content').innerHTML = '<div class="empty-day"><div class="empty-illustration" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M13 9h22a3 3 0 0 1 3 3v28H10V12a3 3 0 0 1 3-3ZM16 6v6m16-6v6M10 18h28M17 27h14m-7-7v14"/><path d="m34 38 5-5m-2 9 6-6"/></svg></div><h3>Пока чистый лист</h3><p>Немного движения — уже победа.<br>Добавь свою первую тренировку<br>в этот день.</p><button class="button" data-action="empty-add"><span class="plus">+</span>Добавить тренировку</button></div>';
  } else {
    $('#day-content').innerHTML = `<p class="day-summary">${workouts.length} ${plural(workouts.length, ['тренировка', 'тренировки', 'тренировок'])} за день</p>` + workouts.map(workout => {
      const type = typeFor(workout);
      const total = noteTotal(workout.note);
      const timeLabel = workout.time ? `<div class="entry-time"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg><time datetime="${escapeHTML(workout.date)}T${escapeHTML(workout.time)}" title="${workout.timeEstimated ? 'Примерное время тренировки' : 'Время тренировки'}" aria-label="${workout.timeEstimated ? 'Примерно ' : ''}${escapeHTML(workout.time)}">${workout.timeEstimated ? '≈ ' : ''}${escapeHTML(workout.time)}</time></div>` : '';
      return `<article class="workout-entry"><div class="entry-header">${icon(type, false)}<h3 class="entry-title">${escapeHTML(type.name)}</h3><div class="entry-actions"><button class="icon-button" data-edit="${escapeHTML(workout.id)}" aria-label="Редактировать ${escapeHTML(type.name)}" title="Редактировать"><svg viewBox="0 0 24 24"><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/></svg></button><button class="icon-button" data-delete="${escapeHTML(workout.id)}" aria-label="Удалить ${escapeHTML(type.name)}" title="Удалить"><svg viewBox="0 0 24 24"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg></button></div></div>${timeLabel}<p class="entry-note${workout.note ? '' : ' no-note'}">${workout.note ? escapeHTML(workout.note) : 'Без заметки'}</p>${total === null ? '' : `<p class="entry-total">Всего: <strong>${formatTotal(total)}</strong></p>`}</article>`;
    }).join('');
  }
}
function renderStats() {
  const monthPrefix = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;
  const monthly = state.workouts.filter(workout => workout.date.startsWith(monthPrefix));
  $('#total-training-days').textContent = new Set(state.workouts.map(workout => workout.date)).size;
  $('#month-detail').textContent = `${capitalize(viewDate.toLocaleDateString('ru-RU', { month: 'long' }))} · ${monthly.length} ${plural(monthly.length, ['запись', 'записи', 'записей'])} упражнений`;
  $('#active-days').textContent = new Set(monthly.map(workout => workout.date)).size;
  $('#month-length').textContent = `/ ${new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()}`;
  const days = new Set(state.workouts.map(workout => workout.date));
  const today = new Date();
  let streak = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  $('#streak').textContent = streak;
  $('#streak-unit').textContent = plural(streak, ['день', 'дня', 'дней']);
  $('#streak-detail').textContent = streak ? 'Продолжай в своём ритме' : 'Начни с одной тренировки';
  let bars = '';
  for (let i = 6; i >= 0; i--) { const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); const count = workoutsOn(dateKey(date)).length; bars += `<i class="${count ? 'on' : ''}" style="height:${count ? Math.min(40, 15 + count * 6) : 9}px"></i>`; }
  $('#activity-bars').innerHTML = bars;
}
function radioOptions(types, name, selected) {
  return types.map(type => `<label class="exercise-option"><input type="radio" name="${name}" value="${escapeHTML(type.id)}" required${type.id === selected ? ' checked' : ''}>${icon(type, false)}<span class="exercise-option-name">${escapeHTML(type.name)}</span><span class="radio-indicator" aria-hidden="true"></span></label>`).join('');
}
function openWorkout(id = null) {
  if (!loaded) { toast(cloudMode ? 'Сначала войди в дневник.' : 'Сначала запусти сайт через файл «Запустить.cmd».'); return; }
  editingId = id;
  const workout = id ? state.workouts.find(item => item.id === id) : null;
  $('#workout-form').reset();
  $('#workout-modal-title').textContent = workout ? 'Редактировать тренировку' : 'Новая тренировка';
  $('#save-workout').textContent = workout ? 'Сохранить изменения' : 'Сохранить тренировку';
  $('#workout-date').value = workout ? workout.date : selectedDate;
  $('#workout-time').value = workout && workout.time ? workout.time : currentTime();
  $('#exercise-options').innerHTML = radioOptions(state.types, 'type', workout ? workout.typeId : state.types[0].id);
  $('#workout-note').value = workout ? workout.note : '';
  updateNotePreview();
  $('#workout-error').hidden = true;
  $('#workout-dialog').showModal();
}
async function commit(next) {
  if (busy) throw new Error('Дождись завершения сохранения.');
  busy = true;
  $('#save-status').innerHTML = '<i></i> Сохраняем…';
  document.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; });
  try {
    const response = await apiRequest('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const result = await response.json();
    if (response.status === 409) {
      state = result.state; render();
      throw new Error('Дневник изменился на другом устройстве или в другой вкладке. Проверь записи и сохрани ещё раз.');
    }
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить данные.');
    state = result;
    $('#connection-error').hidden = true;
    render();
  } catch (error) {
    throw new Error(error instanceof TypeError ? (cloudMode ? 'Нет связи с хранилищем. Проверь интернет и повтори сохранение.' : 'Нет связи с локальным сервером. Запусти «Запустить.cmd» и повтори сохранение.') : error.message);
  } finally {
    busy = false;
    document.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = false; });
    storageStatus();
  }
}

$('#calendar-grid').addEventListener('click', event => {
  const cell = event.target.closest('[data-date]');
  if (!cell) return;
  selectedDate = cell.dataset.date;
  updateSelectedCalendarDay();
  renderDay();
});
$('#calendar-scroll').addEventListener('wheel', event => {
  if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  const scroller = $('#calendar-scroll');
  const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scroller.clientHeight : 1;
  const delta = event.deltaY * unit;
  if (!calendarAnimation || Math.sign(delta) !== Math.sign(calendarTarget - scroller.scrollTop)) calendarTarget = scroller.scrollTop;
  glideCalendarTo(calendarTarget + delta);
}, { passive: false });
$('#calendar-scroll').addEventListener('scroll', () => {
  if (calendarScrollFrame) return;
  calendarScrollFrame = requestAnimationFrame(() => {
    calendarScrollFrame = 0;
    if (!calendarAnimation) calendarTarget = $('#calendar-scroll').scrollTop;
    growCalendar();
    updateCalendarHeading();
  });
}, { passive: true });
['pointerdown', 'touchstart', 'keydown'].forEach(name => $('#calendar-scroll').addEventListener(name, stopCalendarAnimation, { passive: true }));
$('#prev-month').addEventListener('click', () => scrollCalendarToDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)));
$('#next-month').addEventListener('click', () => scrollCalendarToDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)));
function goToday() { const today = new Date(); selectedDate = dateKey(today); updateSelectedCalendarDay(); renderDay(); scrollCalendarToDate(today); }
$('#go-today').addEventListener('click', goToday);
$('#calendar-nav').addEventListener('click', goToday);
$('#add-workout').addEventListener('click', () => openWorkout());
$('#add-selected').addEventListener('click', () => openWorkout());
$('#day-content').addEventListener('click', event => {
  if (event.target.closest('[data-action="empty-add"]')) openWorkout();
  const edit = event.target.closest('[data-edit]');
  if (edit) openWorkout(edit.dataset.edit);
  const remove = event.target.closest('[data-delete]');
  if (remove) { deletingId = remove.dataset.delete; $('#delete-dialog').showModal(); }
});
$('#workout-note').addEventListener('input', updateNotePreview);
$('#time-now').addEventListener('click', () => { $('#workout-time').value = currentTime(); });
$('#workout-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const previous = editingId ? state.workouts.find(workout => workout.id === editingId) : null;
  const time = String(data.get('time'));
  const record = { id: editingId || crypto.randomUUID(), date: String(data.get('date')), time, timeEstimated: Boolean(previous && previous.timeEstimated && previous.time === time), typeId: String(data.get('type')), note: String(data.get('note')).trim() };
  const next = { ...state, workouts: editingId ? state.workouts.map(item => item.id === editingId ? record : item) : [...state.workouts, record] };
  try {
    await commit(next);
    selectedDate = record.date;
    const date = parseDate(record.date);
    render();
    scrollCalendarToDate(date);
    $('#workout-dialog').close();
    toast(editingId ? 'Изменения сохранены' : 'Тренировка добавлена. Ещё один шаг!');
  } catch (error) { $('#workout-error').textContent = error.message; $('#workout-error').hidden = false; }
});
$('#delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await commit({ ...state, workouts: state.workouts.filter(workout => workout.id !== deletingId) }); $('#delete-dialog').close(); toast('Тренировка удалена'); }
  catch (error) { toast(error.message); }
});
$('#add-type').addEventListener('click', () => {
  if (!loaded) { toast(cloudMode ? 'Сначала войди в дневник.' : 'Сначала запусти сайт через файл «Запустить.cmd».'); return; }
  $('#type-form').reset();
  $('#type-error').hidden = true;
  $('#type-icon-options').innerHTML = radioOptions([{ id: 'push', name: 'Силовая', icon: 'push' }, { id: 'pull', name: 'На турнике', icon: 'pull' }, { id: 'walk', name: 'Движение', icon: 'walk' }], 'icon', 'push');
  $('#type-dialog').showModal();
});
$('#type-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('#type-name').value.trim();
  if (!name) { $('#type-name').focus(); return; }
  if (state.types.some(type => type.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'))) { $('#type-error').textContent = 'Такой вид тренировки уже есть.'; $('#type-error').hidden = false; return; }
  const data = new FormData(event.target);
  try { await commit({ ...state, types: [...state.types, { id: crypto.randomUUID(), name, icon: data.get('icon') }] }); $('#type-dialog').close(); toast('Новый вид тренировки добавлен'); }
  catch (error) { $('#type-error').textContent = error.message; $('#type-error').hidden = false; }
});
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { if (!busy) button.closest('dialog').close(); }));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !busy) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
});
$('#export-data').addEventListener('click', () => {
  if (!loaded) { toast('Данные ещё не загружены.'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `ritm-${dateKey(new Date())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function load() {
  try {
    if (cloudMode) { await cloudReady; if (!cloudAdapter?.signedIn()) { showAuth(); return; } }
    const response = await apiRequest('/api/state');

    if (!response.ok) throw new Error('Сервер не смог прочитать файл данных. Проверь окно запуска.');
    state = await response.json();
    loaded = true;
    $('.app-shell').hidden = false; $('#auth-gate').hidden = true;
    render(); storageStatus();
  } catch (error) {
    if (cloudMode) { showAuth('Не удалось подключиться к дневнику. ' + (error instanceof TypeError ? 'Проверь интернет и попробуй ещё раз.' : error.message)); return; }
    $('#connection-error').textContent = location.protocol === 'file:' ? 'Чтобы записи сохранялись в эту папку, закрой этот файл и запусти «Запустить.cmd». Он откроет сайт в браузере и подключит локальный файл данных.' : `Не удалось открыть дневник. ${error instanceof TypeError ? 'Проверь, что локальный сервер запущен через «Запустить.cmd», затем обнови страницу.' : error.message}`;
    $('#connection-error').hidden = false;
    $('#day-content').innerHTML = '<div class="loading-day">Нет связи с файлом данных</div>';
  }
}
$('#retry-cloud').addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (cloudMode && !document.hidden && loaded && !busy && !document.querySelector('dialog[open]')) load(); });
if (cloudMode) {
  const info = $('.sidebar-bottom');
  info.querySelector('strong').textContent = 'Один дневник на всех устройствах';
  info.querySelector('p').textContent = 'Тренировки сохраняются в твоей закрытой базе.';
  const logout = document.createElement('button');
  logout.className = 'text-button'; logout.textContent = 'Выйти';
  logout.addEventListener('click', async () => {
    if (busy) return;
    try { await cloudAdapter.signOut(); } catch { toast('Не удалось выйти. Повтори попытку.'); }
  });
  const sessionControls = document.createElement('div');
  sessionControls.className = 'cloud-session-controls';
  const status = document.createElement('span'); status.id = 'cloud-footer-status';
  sessionControls.append(status, logout);
  $('.page-footer').append(sessionControls);
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('#sign-in'); button.disabled = true;
    $('#login-error').hidden = true;
    try { await cloudReady; await cloudAdapter.signIn($('#login-name').value, $('#login-password').value); }
    catch (error) { $('#login-error').textContent = error.message; $('#login-error').hidden = false; }
    finally { button.disabled = false; }
  });
  cloudReady = startCloud().catch(() => { showAuth('Не удалось подключить Firebase. Проверь интернет и обнови страницу.'); });
} else { render(); load(); }
