/**
 * Note Management Module
 * Handles CRUD operations, localStorage persistence, and UI updates.
 */

const STORAGE_KEY = 'dashboard_notes';

const NoteColor = {
  ACCENT: 'accent',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER: 'danger',
  CYAN: 'cyan',
  PINK: 'pink'
};

const ALLOWED_COLORS = Object.values(NoteColor);

let editingNoteId = null;

// The add/edit form, revealed by the "+ New Note" button. Assigned in init.
let noteFormDisclosure = null;
let modalOpener = null;
let noteViewerOpener = null;
let viewingNoteId = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getNotes() {
  try {
    const notes = localStorage.getItem(STORAGE_KEY);
    if (!notes) return [];
    const parsed = JSON.parse(notes);
    if (!Array.isArray(parsed)) {
      console.error('Stored notes are not an array; ignoring them.');
      return [];
    }
    return parsed.filter(note => note && typeof note === 'object' && note.id);
  } catch (error) {
    console.error('Error loading notes:', error);
    return [];
  }
}

function saveNotes(notes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    return true;
  } catch (error) {
    console.error('Error saving notes:', error);
    showMessage('Failed to save notes. Storage may be full.', 'error');
    return false;
  }
}

function sanitizeColor(color) {
  return ALLOWED_COLORS.includes(color) ? color : NoteColor.ACCENT;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function createNote(data) {
  const title = (data.title || '').trim();
  if (!title) {
    showMessage('Note title is required.', 'error');
    return null;
  }
  const note = {
    id: generateId(),
    title: title,
    body: (data.body || '').trim(),
    url: data.url || '',
    color: sanitizeColor(data.color),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const notes = getNotes();
  notes.push(note);
  if (saveNotes(notes)) {
    showMessage('Note created.', 'success');
    return note.id;
  }
  return null;
}

function updateNote(id, updates) {
  const notes = getNotes();
  const note = notes.find(n => n.id === id);
  if (!note) return false;
  const title = (updates.title !== undefined ? updates.title : note.title).trim();
  if (updates.title !== undefined && !title) {
    showMessage('Note title is required.', 'error');
    return false;
  }
  note.title = title;
  if (updates.body !== undefined) note.body = updates.body.trim();
  if (updates.url !== undefined) note.url = updates.url.trim();
  if (updates.color !== undefined) note.color = sanitizeColor(updates.color);
  note.updatedAt = new Date().toISOString();
  return saveNotes(notes);
}

function deleteNote(id) {
  const notes = getNotes();
  const filtered = notes.filter(n => n.id !== id);
  if (filtered.length === notes.length) return false;
  if (saveNotes(filtered)) {
    showMessage('Note deleted.', 'success');
    return true;
  }
  return false;
}

function showMessage(msg, type) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.className = 'toast ' + (type || '');
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 3000);
  } else {
    console.log('[' + (type || 'info') + ']', msg);
  }
}

function formatNoteDate(dateStr) {
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const dMid = new Date(dateStr); dMid.setHours(0, 0, 0, 0);
  if (dMid.getTime() === today.getTime()) return 'Today';
  if (dMid.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Render a note's link. Notes are stored raw and may predate the field, so
 * re-check the value before it reaches an href.
 */
function noteLinkHtml(note) {
  const link = normalizeLink(note.url);
  if (!link) return '';
  return `<a class="note-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open link for ${escapeHtml(note.title)} (opens in a new tab)">${escapeHtml(displayLink(link))}</a>`;
}

function renderNotes() {
  const container = document.getElementById('notesList');
  if (!container) return;
  const searchInput = document.getElementById('noteSearch');
  const query = searchInput ? searchInput.value.trim().toLocaleLowerCase() : '';
  const allNotes = getNotes();
  if (searchInput) searchInput.hidden = allNotes.length === 0;
  const notes = allNotes.filter(note => !query ||
    [note.title, note.body, note.url].some(value => String(value || '').toLocaleLowerCase().includes(query))
  );
  notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const count = document.getElementById('notesCount');
  if (count) count.textContent = query
    ? `${notes.length} of ${allNotes.length} notes`
    : `${allNotes.length} ${allNotes.length === 1 ? 'note' : 'notes'}`;
  if (allNotes.length === 0) {
    container.innerHTML = '<p class="empty-state">No notes yet. <a href="#noteFormPanel" onclick="document.getElementById(\'newNoteBtn\').click(); return false;">Create your first note</a></p>';
    return;
  }
  if (notes.length === 0) {
    container.innerHTML = '<p class="empty-state">No notes match that search. <button type="button" class="btn btn-secondary" onclick="clearNoteSearch()">Clear search</button></p>';
    return;
  }
  container.innerHTML = notes.map(note => `
    <article class="note-card" aria-label="Note: ${escapeHtml(note.title)}">
      <div class="note-color-bar note-color-${escapeHtml(note.color)}" aria-hidden="true"></div>
      <h3>${escapeHtml(note.title)}</h3>
      <p>${escapeHtml(note.body) || '&nbsp;'}</p>
      ${noteLinkHtml(note)}
      <div class="note-date">${escapeHtml(formatNoteDate(note.updatedAt))}</div>
      <div class="note-actions">
        <button type="button" class="btn btn-secondary" onclick="openNote('${escapeHtml(note.id)}')">Read</button>
        <button type="button" class="btn-icon" onclick="startEditNote('${escapeHtml(note.id)}')" aria-label="Edit note ${escapeHtml(note.title)}">✏️</button>
        <button type="button" class="btn-icon danger" onclick="confirmDeleteNote('${escapeHtml(note.id)}')" aria-label="Delete note ${escapeHtml(note.title)}">🗑️</button>
      </div>
    </article>
  `).join('');
}

function clearNoteSearch() {
  const search = document.getElementById('noteSearch');
  if (!search) return;
  search.value = '';
  renderNotes();
  search.focus();
}

function openNote(id) {
  const note = getNotes().find(item => item.id === id);
  const viewer = document.getElementById('noteViewer');
  if (!note || !viewer) return;
  viewingNoteId = id;
  noteViewerOpener = document.activeElement;
  document.getElementById('noteReaderTitle').textContent = note.title;
  document.getElementById('noteReaderDate').textContent = `Updated ${formatNoteDate(note.updatedAt)}`;
  document.getElementById('noteReaderBody').textContent = note.body || 'This note has no text.';
  const link = document.getElementById('noteReaderLink');
  const safeLink = normalizeLink(note.url);
  if (safeLink) {
    link.href = safeLink;
    link.textContent = `Open link: ${displayLink(safeLink)}`;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }
  viewer.style.display = 'flex';
  document.getElementById('closeNoteViewer').focus();
}

function closeNoteViewer(restoreFocus = true) {
  const viewer = document.getElementById('noteViewer');
  if (viewer) viewer.style.display = 'none';
  viewingNoteId = null;
  if (restoreFocus && noteViewerOpener && document.contains(noteViewerOpener)) noteViewerOpener.focus();
  noteViewerOpener = null;
}

function editViewedNote() {
  const id = viewingNoteId;
  closeNoteViewer(false);
  if (id) {
    startEditNote(id);
    const titleInput = document.getElementById('noteTitle');
    if (titleInput) titleInput.focus();
  }
}

function startEditNote(id) {
  const notes = getNotes();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  editingNoteId = id;
  const titleInput = document.getElementById('noteTitle');
  const bodyInput = document.getElementById('noteBody');
  const urlInput = document.getElementById('noteUrl');
  if (titleInput) titleInput.value = note.title;
  if (bodyInput) bodyInput.value = note.body || '';
  if (urlInput) urlInput.value = note.url || '';
  // Restore color radio
  const colorInput = document.querySelector('input[name="noteColor"][value="' + sanitizeColor(note.color) + '"]');
  if (colorInput) colorInput.checked = true;
  document.getElementById('formTitle').textContent = 'Edit Note';
  document.getElementById('submitBtn').textContent = 'Update Note';

  // Editing an existing note reveals the form, exactly as the New Note button
  // does. open() handles the scroll and honours reduced motion.
  if (noteFormDisclosure) {
    noteFormDisclosure.open({ focus: false });
    noteFormDisclosure.trigger.textContent = '✎ Editing…';
  }
}

/** Put the form away and restore the trigger's resting label. */
function closeNoteForm() {
  if (!noteFormDisclosure) return;
  noteFormDisclosure.close();
  noteFormDisclosure.trigger.textContent = '+ New Note';
}

function cancelEdit() {
  editingNoteId = null;
  const titleInput = document.getElementById('noteTitle');
  const bodyInput = document.getElementById('noteBody');
  const urlInput = document.getElementById('noteUrl');
  if (titleInput) titleInput.value = '';
  if (bodyInput) bodyInput.value = '';
  if (urlInput) urlInput.value = '';
  document.getElementById('formTitle').textContent = 'New Note';
  document.getElementById('submitBtn').textContent = '+ Save';

  // Cancel is not hidden here. The form is a disclosure now, so it is on screen
  // and the user may have typed something to discard. Collapsing the panel is
  // what takes Cancel out of view. restoreFocus stays on so Cancel does not
  // disappear from under the keyboard user who just pressed it.
  closeNoteForm();
}

function confirmDeleteNote(id) {
  const notes = getNotes();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  modalOpener = document.activeElement || document.querySelector('.btn-icon.danger');
  const modal = document.getElementById('confirmModal');
  if (modal) modal.dataset.noteId = id;
  const msg = document.getElementById('confirmMessage');
  if (msg) msg.textContent = 'Are you sure you want to delete "' + note.title + '"?';
  if (modal) modal.style.display = 'flex';
  setTimeout(() => {
    const cancelBtn = document.getElementById('cancelModal');
    if (cancelBtn) cancelBtn.focus();
  }, 50);
}

function closeModal() {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.style.display = 'none';
  if (modalOpener && document.body.contains(modalOpener)) modalOpener.focus();
}

function trapModalFocus(event) {
  const viewer = document.getElementById('noteViewer');
  const confirm = document.getElementById('confirmModal');
  const modal = viewer && viewer.style.display === 'flex'
    ? viewer
    : confirm && confirm.style.display !== 'none' ? confirm : null;
  if (!modal) return;
  if (event.key === 'Escape') {
    if (modal === viewer) closeNoteViewer();
    else closeModal();
    return;
  }
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const visibleFocusable = Array.from(focusable).filter(el => el.offsetParent !== null);
  if (visibleFocusable.length === 0) return;
  const first = visibleFocusable[0];
  const last = visibleFocusable[visibleFocusable.length - 1];
  if (event.key === 'Tab') {
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}

function init() {
  // The form starts collapsed, revealed by "+ New Note".
  noteFormDisclosure = window.FormDisclosure
    ? window.FormDisclosure.attach(
        document.getElementById('newNoteBtn'),
        document.getElementById('noteFormPanel'),
        { focusTarget: '#noteTitle' }
      )
    : null;

  renderNotes();
  const form = document.getElementById('noteForm');
  if (form) {
    form.onsubmit = function(e) {
      e.preventDefault();
      const titleInput = document.getElementById('noteTitle');
      const bodyInput = document.getElementById('noteBody');
      const urlInput = document.getElementById('noteUrl');
      const colorInputs = document.querySelectorAll('input[name="noteColor"]');
      const title = titleInput ? titleInput.value.trim() : '';
      const body = bodyInput ? bodyInput.value.trim() : '';
      const rawUrl = urlInput ? urlInput.value.trim() : '';

      // A link is optional, but a typed-and-unusable one is a mistake worth
      // reporting rather than silently dropping.
      const url = normalizeLink(rawUrl);
      if (rawUrl && !url) {
        showMessage('That link is not a valid web address.', 'error');
        if (urlInput) {
          urlInput.setAttribute('aria-invalid', 'true');
          urlInput.focus();
        }
        return;
      }
      if (urlInput) urlInput.removeAttribute('aria-invalid');

      let color = 'accent';
      colorInputs.forEach(input => { if (input.checked) color = input.value; });
      let saved;
      if (editingNoteId) {
        saved = updateNote(editingNoteId, { title: title, body: body, url: url || '', color: color });
        if (!saved) return;
        editingNoteId = null;
        document.getElementById('formTitle').textContent = 'New Note';
        document.getElementById('submitBtn').textContent = '+ Save';
      } else {
        saved = createNote({ title: title, body: body, url: url || '', color: color });
        if (!saved) return;
      }
      if (titleInput) titleInput.value = '';
      if (bodyInput) bodyInput.value = '';
      if (urlInput) urlInput.value = '';
      closeNoteForm();
      renderNotes();
    };
  }
  document.getElementById('cancelBtn').onclick = function() {
    cancelEdit();
    const colorAccent = document.getElementById('colorAccent');
    if (colorAccent) colorAccent.checked = true;
  };
  document.getElementById('cancelModal').onclick = () => closeModal();
  document.getElementById('confirmDelete').onclick = () => {
    const id = document.getElementById('confirmModal').dataset.noteId;
    if (id) { deleteNote(id); renderNotes(); }
    closeModal();
  };
  const noteSearch = document.getElementById('noteSearch');
  if (noteSearch) noteSearch.addEventListener('input', renderNotes);
  document.getElementById('closeNoteViewer').addEventListener('click', () => closeNoteViewer());
  document.getElementById('closeNoteViewerAction').addEventListener('click', () => closeNoteViewer());
  document.getElementById('editViewedNote').addEventListener('click', editViewedNote);
  document.getElementById('noteViewer').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeNoteViewer();
  });
  document.addEventListener('keydown', trapModalFocus);
}

window.startEditNote = startEditNote;
window.cancelEdit = cancelEdit;
window.confirmDeleteNote = confirmDeleteNote;
window.closeModal = closeModal;
window.openNote = openNote;
window.clearNoteSearch = clearNoteSearch;

if (document.readyState === 'loading') {
  window.addEventListener('dashly:remote-update', event => {
    if (event.detail && event.detail.collection === 'notes') renderNotes();
  });

  if (window.DashlyCloud) window.DashlyCloud.start(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
} else {
  init();
}
