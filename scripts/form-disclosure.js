/**
 * Form Disclosure
 *
 * Every add/edit form on the site starts collapsed behind a button, and opens
 * when the user asks to add something or clicks edit on an existing item. The
 * point is that opening a page should show the content, not five input panels.
 *
 * This module owns the behaviour so all six forms behave identically. Each page
 * only supplies the trigger and the panel; every page's own startEdit* function
 * calls open() so editing an existing item reveals the form the same way the
 * Add button does.
 *
 * The panel is hidden with the `hidden` attribute rather than a CSS rule, so it
 * is genuinely removed from the tab order and from the accessibility tree
 * instead of merely looking invisible.
 */
(function () {
  'use strict';

  const OPEN = 'true';
  const CLOSED = 'false';

  /**
   * @param {HTMLButtonElement} trigger  the button that opens and closes it
   * @param {HTMLElement} panel          the element to hide and show
   * @param {object} [opts]
   * @param {string} [opts.focusTarget]  selector for the first field to focus
   * @param {string} [opts.scroll]       'auto' honours reduced motion
   */
  function attach(trigger, panel, opts) {
    if (!trigger || !panel) return null;
    const options = opts || {};

    if (!panel.id) {
      // aria-controls needs a stable target.
      panel.id = panel.id || 'disclosure-' + Math.random().toString(36).slice(2, 9);
    }

    const controller = {
      trigger: trigger,
      panel: panel,
      isOpen: false,

      open: function (opts2) {
        if (controller.isOpen) return;
        const o = opts2 || {};

        panel.hidden = false;
        trigger.setAttribute('aria-expanded', OPEN);
        controller.isOpen = true;

        if (o.scroll !== false) {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          try {
            panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
          } catch (e) {
            panel.scrollIntoView();
          }
        }

        if (o.focus !== false) {
          // The focusTarget given to attach() is the default; a caller can
          // override it per-open. Falls back to the first real control, which
          // is what a page that supplies no focusTarget gets.
          const selector = o.focusTarget || options.focusTarget ||
            'input:not([type="hidden"]), textarea, select';
          const target = panel.querySelector(selector);
          if (target) target.focus({ preventScroll: true });
        }
      },

      close: function (opts2) {
        const o = opts2 || {};
        if (!controller.isOpen) return;

        panel.hidden = true;
        trigger.setAttribute('aria-expanded', CLOSED);
        controller.isOpen = false;

        // Focus returns to the control that opened it, so keyboard and screen
        // reader users are not dropped at the top of the document.
        if (o.restoreFocus !== false) trigger.focus({ preventScroll: true });
      },

      toggle: function () {
        controller.isOpen ? controller.close() : controller.open();
      },

      /** Update the trigger's visible text, e.g. Add -> Editing. */
      setLabel: function (text) {
        trigger.textContent = text;
      }
    };

    trigger.setAttribute('aria-expanded', CLOSED);
    trigger.setAttribute('aria-controls', panel.id);
    panel.hidden = true;

    trigger.addEventListener('click', function () {
      controller.toggle();
    });

    // Escape closes an open form, matching the delete dialogs on every page.
    // Guarded on the panel being visible so a single Escape never closes
    // something the user never opened.
    panel.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!controller.isOpen) return;

      // Do not steal Escape from an open dialog sitting on top of the form.
      const modal = document.querySelector('.modal[aria-modal="true"]');
      if (modal && modal.style.display !== 'none' && modal.style.display !== '') return;

      event.preventDefault();
      controller.close();
    });

    return controller;
  }

  window.FormDisclosure = { attach: attach };
})();
