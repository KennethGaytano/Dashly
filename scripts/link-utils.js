/**
 * Shared link helpers
 *
 * One implementation for all three pages. This started as three byte-identical
 * copies (calendar-events.js, tasks.js, notes.js); the duplication mattered
 * because the function decides what may be rendered into an href, so a fix to
 * one copy and not the others would be a security gap, not just DRY-ness.
 *
 * Loaded as a plain script before the page scripts, so it must not assume a
 * module system. Names are prefixed to avoid colliding with page globals.
 */
(function (global) {
  'use strict';

  /**
   * Accept what people actually paste — "example.com/x", "HTTP://…" — and
   * return an absolute http(s) URL, or null if it is not one.
   *
   * Anything else (javascript:, data:, mailto:) is rejected rather than
   * rendered into an href. Only http and https are ever returned.
   */
  function normalizeLink(raw) {
    const value = (raw || '').trim();
    if (!value) return null;
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Trim the scheme and any trailing slash so a row shows "example.com/x"
   * rather than the full href. Falls back to the whole URL if trimming would
   * leave nothing meaningful.
   */
  function displayLink(href) {
    return href.replace(/^https?:\/\//i, '').replace(/\/$/, '') || href;
  }

  global.normalizeLink = normalizeLink;
  global.displayLink = displayLink;
})(window);
