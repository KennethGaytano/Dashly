/**
 * Home Page Quick Notes
 * Renders recent notes from the same store the Notes page uses.
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
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
      container.innerHTML = '<p class="empty-state">No notes yet. <a href="pages/notes.html?new=1">Create your first note</a></p>';
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
  }

  window.addEventListener('dashly:remote-update', event => {
    if (event.detail && event.detail.collection === 'notes') renderQuickNotes();
  });

  if (window.DashlyCloud) window.DashlyCloud.start(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
