/**
 * Calendar Events Module
 * CRUD events in localStorage (dashboard_events).
 *
 * State lives in one place: the selected grid day. Everything that changes
 * data calls refreshAll(), which re-reads the selection and re-renders the
 * selected-day panel, the Upcoming list, and the grid dots.
 */
const STORAGE_KEY = 'dashboard_events';

let editingEventId = null;

// The add/edit form, revealed by the "+ Add event" button. Assigned in init.
let eventFormDisclosure = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Error loading events:', e);
    return [];
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    return true;
  } catch (e) {
    console.error('Error saving events:', e);
    toast('Could not save — browser storage may be full.', 'error');
    return false;
  }
}

const ESCAPE_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };

function escapeHtml(s) {
  return typeof s === 'string' ? s.replace(/[&<>"']/g, c => ESCAPE_MAP[c]) : '';
}

/** Local-time YYYY-MM-DD. Never use toISOString() here: it is UTC, which
 *  rolls over to tomorrow for most of the evening in negative-offset zones. */
function localDateKey(d) {
  const date = d || new Date();
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

function formatEventDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDayHeading(dateStr) {
  const today = localDateKey();
  if (dateStr === today) return 'Today';
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const diff = Math.round((target - new Date(y, m, d === new Date().getDate() ? m : m, d)) / 86400000);
  if (dateStr === localDateKey(new Date(Date.now() + 86400000))) return 'Tomorrow';
  return target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return hour12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

/** Local-time YYYY-MM-DD. Never use toISOString() here: it is UTC, which
 *  rolls over to tomorrow for most of the evening in negative-offset zones. */
function toast(msg, type) {
  const el = document.getElementById('calendarToast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + (type || '');
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ===== Single source of truth: the selected grid day ===== */

function selectedDateKey() {
  const btn = document.querySelector('#calendarGrid button.calendar-day.selected[data-date]');
  return btn ? btn.getAttribute('data-date') : null;
}

function refreshDots() {
  const dates = window.getCalendarEventDates();
  document.querySelectorAll('#calendarGrid button.calendar-day').forEach(btn => {
    btn.classList.toggle('has-event', dates.has(btn.getAttribute('data-date')));
  });
}

/* ===== Rendering ===== */

function eventRow(ev, showDate) {
  const detail = [];
  if (showDate) detail.push(escapeHtml(formatDayHeading(ev.date)));
  if (ev.time) detail.push(escapeHtml(formatTime(ev.time)));
  if (ev.description) detail.push(escapeHtml(ev.description));

  const row = document.createElement('div');
  row.className = 'event-item';
  row.setAttribute('role', 'listitem');

  const text = document.createElement('div');
  text.className = 'event-item-text';
  const title = document.createElement('div');
  title.className = 'event-item-title';
  title.textContent = ev.title;
  text.appendChild(title);

  // Older events predate the link field, and a stored value may have been
  // hand-edited into something unsafe, so re-check before rendering href.
  const link = normalizeLink(ev.url);
  if (link) {
    const a = document.createElement('a');
    a.className = 'event-item-link';
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = displayLink(link);
    a.setAttribute('aria-label', 'Open link for ' + ev.title + ' (opens in a new tab)');
    text.appendChild(a);
  }

  if (detail.length) {
    const meta = document.createElement('div');
    meta.className = 'event-item-meta';
    meta.textContent = detail.join(' — ');
    text.appendChild(meta);
  }
  row.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'event-item-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-icon';
  editBtn.textContent = '✏️';
  editBtn.setAttribute('aria-label', 'Edit event ' + ev.title);
  editBtn.addEventListener('click', () => startEditEvent(ev.id));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn-icon danger';
  delBtn.textContent = '🗑️';
  delBtn.setAttribute('aria-label', 'Delete event ' + ev.title);
  delBtn.addEventListener('click', () => deleteEvent(ev.id));
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

function renderEventList(dateKey) {
  const container = document.getElementById('eventList');
  const label = document.getElementById('selectedDateLabel');
  if (!container) return;

  const events = getEvents()
    .filter(e => e.date === dateKey)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  container.innerHTML = '';
  if (label) label.textContent = formatEventDate(dateKey);

  if (events.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No events on this day.';
    container.appendChild(p);
    return;
  }
  events.forEach(ev => container.appendChild(eventRow(ev, false)));
}

function renderUpcomingEvents() {
  const container = document.getElementById('upcomingEventsList');
  if (!container) return;

  const todayKey = localDateKey();
  const events = getEvents()
    .filter(e => e.date && e.date >= todayKey)
    .sort((a, b) => (a.date + ' ' + (a.time || '')).localeCompare(b.date + ' ' + (b.time || '')));

  container.innerHTML = '';
  if (events.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No upcoming events.';
    container.appendChild(p);
    return;
  }

  // Group by day so the list has scannable structure instead of one flat run.
  let lastDate = null;
  events.forEach(ev => {
    if (ev.date !== lastDate) {
      lastDate = ev.date;
      const h = document.createElement('h3');
      h.className = 'event-group-heading';
      h.textContent = formatDayHeading(ev.date);
      container.appendChild(h);
    }
    container.appendChild(eventRow(ev, false));
  });
}

function refreshAll() {
  const key = selectedDateKey();
  if (key) {
    renderEventList(key);
    const dateInput = document.getElementById('eventDate');
    if (dateInput && !editingEventId) dateInput.value = key;
  }
  renderUpcomingEvents();
  refreshDots();
}

/* ===== Delete confirmation modal ===== */

// Focus the control that opened the dialog, so it can be restored on close.
let deleteModalOpener = null;
// What to run when Delete is pressed. Kept as a function rather than an id
// so the bulk and single-event paths share one dialog.
let pendingDeleteAction = null;

function requestDelete(message, action) {
  const modal = document.getElementById('calendarDeleteModal');
  const messageEl = document.getElementById('deleteModalMessage');
  if (!modal || !messageEl) {
    // No dialog in the DOM: never delete without asking.
    if (window.confirm(message)) action();
    return;
  }

  messageEl.textContent = message;
  pendingDeleteAction = action;
  deleteModalOpener = document.activeElement;
  modal.style.display = 'flex';
  modal.dataset.open = 'true';

  // Cancel is the safe default, so it takes focus — Enter should not delete.
  const cancelBtn = document.getElementById('cancelDeleteModal');
  if (cancelBtn) cancelBtn.focus();
}

function closeDeleteModal() {
  const modal = document.getElementById('calendarDeleteModal');
  if (!modal || modal.dataset.open !== 'true') return;

  modal.style.display = 'none';
  delete modal.dataset.open;
  pendingDeleteAction = null;

  if (deleteModalOpener && document.body.contains(deleteModalOpener)) {
    deleteModalOpener.focus({ preventScroll: true });
  }
  deleteModalOpener = null;
}

function confirmDelete() {
  const action = pendingDeleteAction;
  closeDeleteModal();
  if (action) action();
}

function trapDeleteModalFocus(event) {
  if (event.key !== 'Tab') return;
  const modal = document.getElementById('calendarDeleteModal');
  if (!modal || modal.dataset.open !== 'true') return;

  const focusable = Array.from(
    modal.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
  ).filter(el => el.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ===== CRUD ===== */

function setEditMode(ev) {
  const form = document.getElementById('eventForm');
  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = document.getElementById('cancelEventBtn');
  const banner = document.getElementById('editBanner');
  const titleInput = document.getElementById('eventTitle');
  const timeInput = document.getElementById('eventTime');
  const descInput = document.getElementById('eventDesc');
  const dateInput = document.getElementById('eventDate');
  const urlInput = document.getElementById('eventUrl');

  if (ev) {
    editingEventId = ev.id;
    if (titleInput) titleInput.value = ev.title;
    if (timeInput) timeInput.value = ev.time || '';
    if (descInput) descInput.value = ev.description || '';
    if (dateInput) dateInput.value = ev.date;
    if (urlInput) urlInput.value = ev.url || '';
    if (submitBtn) submitBtn.textContent = 'Save changes';
    if (banner) {
      banner.hidden = false;
      banner.textContent = 'Editing: ' + ev.title + ' — ' + formatEventDate(ev.date);
    }
    if (titleInput) {
      // Editing an existing event reveals the form, exactly as the Add button
      // does. open() handles the scroll and honours reduced motion.
      if (eventFormDisclosure) {
        eventFormDisclosure.open({ focus: false });
        eventFormDisclosure.trigger.textContent = '✎ Editing…';
      }
      titleInput.focus({ preventScroll: true });
    }
  } else {
    editingEventId = null;
    if (titleInput) titleInput.value = '';
    if (timeInput) timeInput.value = '';
    if (descInput) descInput.value = '';
    if (urlInput) urlInput.value = '';
    if (dateInput) dateInput.value = selectedDateKey() || localDateKey();
    if (submitBtn) submitBtn.textContent = 'Add event';
    if (banner) banner.hidden = true;
  }
}

/** Put the form away and return the trigger to its resting label. Called after
 *  a save, and by Cancel. The user is left looking at the day list. */
function closeEventForm() {
  if (!eventFormDisclosure) return;
  eventFormDisclosure.close();
  eventFormDisclosure.trigger.textContent = '+ Add event';
}

function startEditEvent(eventId) {
  const ev = getEvents().find(e => e.id === eventId);
  if (ev) setEditMode(ev);
}

/** Performs the delete. Split out so the dialog can call it after the user
 *  confirms; the button that opened the dialog is gone by then, so focus has
 *  to be re-homed onto whatever is left. */
function performDelete(id) {
  if (!saveEvents(getEvents().filter(e => e.id !== id))) return;
  if (editingEventId === id) setEditMode(null);
  refreshAll();
  toast('Event deleted.', 'success');

  // The clicked button is gone; keep focus inside the list.
  const next = document.querySelector('#eventList .btn-icon') ||
               document.querySelector('#upcomingEventsList .btn-icon') ||
               document.getElementById('eventTitle');
  if (next) next.focus({ preventScroll: true });
}

function deleteEvent(id) {
  const ev = getEvents().find(e => e.id === id);
  if (!ev) return;
  requestDelete('Delete "' + ev.title + '"? This cannot be undone.', () => performDelete(id));
}

function clearPastEvents() {
  const todayKey = localDateKey();
  const stale = getEvents().filter(e => e.date && e.date < todayKey);
  if (stale.length === 0) {
    toast('No past events to delete.', '');
    return;
  }
  const noun = stale.length === 1 ? 'event' : 'events';
  requestDelete('Delete ' + stale.length + ' past ' + noun + '? This cannot be undone.', () => {
    if (!saveEvents(getEvents().filter(e => !e.date || e.date >= todayKey))) return;
    refreshAll();
    toast('Deleted ' + stale.length + ' past ' + noun + '.', 'success');
  });
}

function handleSubmit(e) {
  e.preventDefault();

  const titleInput = document.getElementById('eventTitle');
  const timeInput = document.getElementById('eventTime');
  const descInput = document.getElementById('eventDesc');
  const dateInput = document.getElementById('eventDate');
  const urlInput = document.getElementById('eventUrl');
  const title = titleInput ? titleInput.value.trim() : '';
  const date = dateInput ? dateInput.value : '';

  if (!date) {
    toast('Pick a date for the event.', 'error');
    if (dateInput) dateInput.focus();
    return;
  }
  if (!title) {
    toast('Event title is required.', 'error');
    if (titleInput) titleInput.focus();
    return;
  }

  // A typed link is optional, but a typed-and-unusable one is a mistake
  // worth reporting rather than silently discarding.
  const rawUrl = urlInput ? urlInput.value.trim() : '';
  const url = normalizeLink(rawUrl);
  if (rawUrl && !url) {
    toast('That link is not a valid web address.', 'error');
    if (urlInput) {
      urlInput.setAttribute('aria-invalid', 'true');
      urlInput.focus();
    }
    return;
  }
  if (urlInput) urlInput.removeAttribute('aria-invalid');

  const time = timeInput ? timeInput.value : '';
  const description = descInput ? descInput.value.trim() : '';
  const events = getEvents();

  if (editingEventId) {
    const ev = events.find(x => x.id === editingEventId);
    if (!ev) { setEditMode(null); return; }
    ev.title = title;
    ev.time = time;
    ev.description = description;
    ev.date = date;
    ev.url = url;
    ev.updatedAt = new Date().toISOString();
    if (!saveEvents(events)) return;
    toast('Event updated.', 'success');
  } else {
    events.push({
      id: generateId(),
      title: title,
      date: date,
      time: time,
      description: description,
      url: url,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!saveEvents(events)) return;
    toast('Event added to ' + formatEventDate(date) + '.', 'success');
  }

  setEditMode(null);
  closeEventForm();
  refreshAll();
  // closeEventForm() returns focus to the trigger. Do not refocus #eventTitle
  // here: the panel is hidden now, and focusing a hidden field strands the
  // user with focus on an element they cannot see.
}

function selectDay(key) {
  const label = document.getElementById('selectedDateLabel');
  const dateInput = document.getElementById('eventDate');
  const banner = document.getElementById('editBanner');

  // Selecting a different day abandons an in-progress edit, so the next
  // thing typed can never silently overwrite an unrelated event.
  if (editingEventId && dateInput && dateInput.value !== key) setEditMode(null);

  if (label) label.textContent = formatEventDate(key);
  if (banner && !editingEventId) banner.hidden = true;
  renderEventList(key);
  if (dateInput && !editingEventId) dateInput.value = key;
  refreshDots();
}

/* ===== Init ===== */

function initEvents() {
  // The form starts collapsed, revealed by "+ Add event". Selecting a day
  // updates the list but leaves the form alone: opening a calendar should not
  // summon an input panel.
  eventFormDisclosure = window.FormDisclosure
    ? window.FormDisclosure.attach(
        document.getElementById('newEventBtn'),
        document.getElementById('eventFormPanel'),
        { focusTarget: '#eventTitle' }
      )
    : null;

  const form = document.getElementById('eventForm');
  if (form) form.addEventListener('submit', handleSubmit);

  const cancelBtn = document.getElementById('cancelEventBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      setEditMode(null);
      closeEventForm();
      refreshAll();
    });
  }

  const clearBtn = document.getElementById('clearPastBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearPastEvents);

  const deleteModal = document.getElementById('calendarDeleteModal');
  const cancelDeleteBtn = document.getElementById('cancelDeleteModal');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmDelete);
  if (deleteModal) {
    // Clicking the backdrop cancels; the dialog box itself does not.
    deleteModal.addEventListener('click', e => {
      if (e.target === deleteModal) closeDeleteModal();
    });
  }

  const grid = document.getElementById('calendarGrid');
  if (grid) {
    grid.addEventListener('click', e => {
      const btn = e.target.closest('.calendar-day');
      if (!btn) return;
      grid.querySelectorAll('.calendar-day.selected').forEach(el => {
        el.classList.remove('selected');
        el.removeAttribute('aria-selected');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-selected', 'true');
      selectDay(btn.getAttribute('data-date'));
    });
  }

  // Preselect today so the form is never in an un-submittable state.
  const todayBtn = document.querySelector('#calendarGrid button.calendar-day.today[data-date]') ||
                   document.querySelector('#calendarGrid button.calendar-day[data-date]');
  if (todayBtn) todayBtn.click();

  // Escape cancels the dialog; Tab stays inside it while open.
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('calendarDeleteModal');
    const isOpen = modal && modal.dataset.open === 'true';
    if (!isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteModal();
      return;
    }
    trapDeleteModalFocus(event);
  });

  refreshAll();
}

window.getCalendarEventDates = function() {
  const set = new Set();
  getEvents().forEach(e => { if (e.date) set.add(e.date); });
  return set;
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEvents);
} else {
  initEvents();
}
