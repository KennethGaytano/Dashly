/**
 * Navigation Module
 * Mobile drawer toggle, scrim dismissal, and focus management.
 * Loaded on every page.
 *
 * The drawer is opened by the "More" tab in the mobile tab bar. It used to be
 * opened by a floating hamburger button, but a second control for the same
 * drawer was redundant next to a tab bar that already offers one.
 */

(function() {
  'use strict';

  const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  let lastFocused = null;
  let scrollbarTimer = null;

  /** The More tab: the only control that opens the drawer. */
  function getToggle() {
    return document.querySelector('.tab-more');
  }

  function getSidebar() {
    return document.querySelector('aside');
  }

  function isOpen() {
    return document.body.classList.contains('nav-open');
  }

  function openNav() {
    const sidebar = getSidebar();
    const toggle = getToggle();
    if (!sidebar || !toggle) return;

    lastFocused = document.activeElement;
    document.body.classList.add('nav-open');
    toggle.setAttribute('aria-expanded', 'true');

    // Move focus into the drawer so keyboard users land on the nav
    const firstLink = sidebar.querySelector('.sidebar-nav a');
    if (firstLink) firstLink.focus();
  }

  function closeNav({ restoreFocus = true } = {}) {
    const toggle = getToggle();
    if (!toggle) return;

    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');

    if (restoreFocus) {
      const target = lastFocused && document.contains(lastFocused) ? lastFocused : toggle;
      target.focus();
    }
    lastFocused = null;
  }

  function toggleNav() {
    if (isOpen()) {
      closeNav();
    } else {
      openNav();
    }
  }

  function revealScrollbar() {
    document.documentElement.classList.add('is-scrolling');
    window.clearTimeout(scrollbarTimer);
    scrollbarTimer = window.setTimeout(() => {
      document.documentElement.classList.remove('is-scrolling');
    }, 850);
  }

  /**
   * Trap Tab inside the sidebar while it is open on mobile, so focus
   * cannot wander into the inert page behind it.
   */
  function trapFocus(event) {
    if (event.key !== 'Tab' || !isOpen()) return;

    const sidebar = getSidebar();
    if (!sidebar) return;

    const focusable = Array.from(sidebar.querySelectorAll(FOCUSABLE))
      .filter(el => el.offsetParent !== null);

    if (focusable.length === 0) return;

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

  function init() {
    const toggle = getToggle();
    const scrim = document.querySelector('.nav-scrim');
    const sidebar = getSidebar();

    document.addEventListener('scroll', revealScrollbar, { capture: true, passive: true });

    if (toggle) {
      toggle.addEventListener('click', toggleNav);
    }

    if (scrim) {
      scrim.addEventListener('click', () => closeNav());
    }

    if (sidebar) {
      // Any navigation dismisses the drawer
      sidebar.addEventListener('click', (event) => {
        if (event.target.closest('a') && isOpen()) {
          closeNav({ restoreFocus: false });
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        closeNav();
      }
      trapFocus(event);
    });

    // Leaving the mobile breakpoint while open would strand the body class
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (e) => {
      if (e.matches && isOpen()) {
        closeNav({ restoreFocus: false });
      }
    };
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
    } else if (mq.addListener) {
      mq.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
