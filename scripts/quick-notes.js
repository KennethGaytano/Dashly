/**
 * Home Page Quick Notes
 * Reads and creates notes in the same store the Notes page uses.
 * Small helpers are duplicated here rather than shared, matching the
 * existing convention in home.js.
 */

(function() {
  const STORAGE_KEY = 'dashboard_notes';

  /**
   * Get notes from localStorage
   */
  function getNotes() {
    try {
      const notes = localStorage.getItem(STORAGE_KEY);
      return notes ? JSON.parse(notes) : [];
    } catch (error) {
      console.error('Error loading notes:', error);
      return [];
    }
  }

  /**
   * Save notes to localStorage
   */
  function saveNotes(notes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      return true;
    } catch (error) {
      console.error('Error saving notes:', error);
      showMessage('Failed to save note. Storage may be full.', 'error');
      return false;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show a toast message
   */
  function showMessage(msg, type) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.className = 'toast ' + (type || '') + ' show';
      // The .show class handles visibility; display:none is not used so
      // reduced-motion and screen-reader live-region toggles work correctly.
      setTimeout(() => { toast.classList.remove('show'); }, 3000);
    } else {
      console.log('[' + (type || 'info') + ']', msg);
    }
  }

  /**
   * Format a note's updated date as Today, Yesterday, or a readable date
   */
  function formatNoteDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const day = new Date(date);
    day.setHours(0, 0, 0, 0);

    if (day.getTime() === today.getTime()) return 'Today';
    if (day.getTime() === yesterday.getTime()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function normalizeLink(raw) {
    const value = (raw || '').trim();
    if (!value) return null;
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch (e) { return null; }
  }
  function displayLink(href) {
    return href.replace(/^https?:\/\//i, '').replace(/\/$/, '') || href;
  }

  /**
   * Render the three most recently updated notes
   */
  function renderQuickNotes() {
    const container = document.getElementById('quickNotesList');
    if (!container) return;

    const notes = getNotes()
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 3);

    if (notes.length === 0) {
      container.innerHTML = '<p class="empty-state">No notes yet. <a href="pages/notes.html">Create your first note</a></p>';
      return;
    }

    container.innerHTML = notes.map(note => `
      <a href="pages/notes.html" class="note-card">
        <div class="note-color-bar note-color-${escapeHtml(note.color)}" aria-hidden="true"></div>
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.body || '')}</p>
        ${(function() {
          const link = normalizeLink(note.url || '');
          return link ? `<span class="note-link" onclick="window.open('${escapeHtml(link)}','_blank','noopener,noreferrer');event.stopPropagation();" aria-label="Open link for ${escapeHtml(note.title)} (opens in a new tab)">${escapeHtml(displayLink(link))}</span>` : '';
        })()}
        <div class="note-date">${escapeHtml(formatNoteDate(note.updatedAt))}</div>
      </a>
    `).join('');
  }

  function init() {
    renderQuickNotes();

    // The composer starts collapsed behind "+ Quick Note", so the home page
    // shows the notes rather than an input box.
    const disclosure = window.FormDisclosure
      ? window.FormDisclosure.attach(
          document.getElementById('newQuickNoteBtn'),
          document.getElementById('quickNotePanel'),
          { focusTarget: '#quickNoteTitle' }
        )
      : null;

    // Cancel discards the draft and puts the composer away, matching every
    // other form on the site. The other five hide their Cancel until an edit is
    // in progress, but this one has no edit mode, so Cancel is the only way to
    // back out of a half-typed thought short of Escape.
    const cancelBtn = document.getElementById('cancelQuickNoteBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        const input = document.getElementById('quickNoteTitle');
        if (input) input.value = '';
        if (disclosure) disclosure.close();
      });
    }

    const form = document.getElementById('quickNoteForm');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();

        const input = document.getElementById('quickNoteTitle');
        if (!input) return;

        const title = input.value.trim();
        if (!title) {
          showMessage('Note title is required.', 'error');
          return;
        }

        const notes = getNotes();
        const now = new Date().toISOString();
        notes.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          title: title,
          body: '',
          color: 'accent',
          createdAt: now,
          updatedAt: now
        });

        if (saveNotes(notes)) {
          input.value = '';
          // One quick thought, one click: put the composer away again so the
          // new note in the list below is what the user is left looking at.
          if (disclosure) disclosure.close();
          showMessage('Note created.', 'success');
          renderQuickNotes();
        }
      });
    }
  }

  window.addEventListener('dashly:remote-update', event => {
    if (event.detail && event.detail.collection === 'notes') renderQuickNotes();
  });

  if (window.DashlyCloud) window.DashlyCloud.start(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
