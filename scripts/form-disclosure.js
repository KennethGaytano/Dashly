/**
 * Form Disclosure
 *
 * Every add/edit form on the site starts closed behind a button and opens as
 * the same popup when the user asks to add something or edits an existing item. The
 * point is that opening a page should show the content, not five input panels.
 *
 * This module owns the behaviour so all six forms behave identically. Each page
 * only supplies the trigger and the panel; every page's own startEdit* function
 * calls open() so editing an existing item reveals the form the same way the
 * Add button does.
 *
 * Closed panels use `hidden`; open panels are moved to the document root so
 * page-level transforms cannot clip their fixed-position dialog surface.
 */
(function () {
  'use strict';

  const OPEN = 'true';
  const CLOSED = 'false';
  const CLOSE_DELAY = 180;

  function titleText(panel, trigger, origin) {
    const parentHeading = origin && origin.querySelector('h2');
    const parentTitle = parentHeading && parentHeading.textContent.trim();
    if (parentTitle && /\b(add|edit|new)\b/i.test(parentTitle)) return parentTitle;
    return trigger.textContent.replace(/^[+\s]+/, '').trim();
  }

  function prepareDialog(panel, trigger, close, origin) {
    const existingTitlebar = panel.querySelector('.form-dialog-titlebar');
    if (existingTitlebar) {
      const generatedTitle = existingTitlebar.querySelector('[data-generated-title]');
      if (generatedTitle) generatedTitle.textContent = titleText(panel, trigger, origin);
      return;
    }
    const card = panel.querySelector('.card') || panel;
    const heading = Array.from(panel.querySelectorAll('h1, h2, h3')).find(function (item) {
      return card.contains(item);
    });
    const titlebar = document.createElement('div');
    titlebar.className = 'form-dialog-titlebar';

    if (heading) {
      heading.classList.add('form-dialog-title');
      titlebar.appendChild(heading);
    } else {
      const title = document.createElement('h2');
      title.textContent = titleText(panel, trigger, origin);
      title.id = panel.id + '-dialog-title';
      title.className = 'form-dialog-title';
      title.dataset.generatedTitle = '';
      titlebar.appendChild(title);
    }

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'form-dialog-close';
    closeButton.setAttribute('aria-label', 'Close form');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', function () { close(); });
    titlebar.appendChild(closeButton);
    card.insertBefore(titlebar, card.firstChild);
    const title = titlebar.querySelector('.form-dialog-title');
    if (title && !title.id) title.id = panel.id + '-dialog-title';
    panel.setAttribute('aria-labelledby', title.id);
    panel.removeAttribute('aria-label');
  }

  /**
   * @param {HTMLButtonElement} trigger  the button that opens and closes it
   * @param {HTMLElement} panel          the element to hide and show
   * @param {object} [opts]
   * @param {string} [opts.focusTarget]  selector for the first field to focus
   */
  function attach(trigger, panel, opts) {
    if (!trigger || !panel) return null;
    const options = opts || {};
    let backdrop = null;
    let closeTimer = null;
    let opener = null;
    let placeholder = null;

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

        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = null;
        }
        if (!placeholder) {
          placeholder = document.createComment('form-dialog');
          panel.parentNode.insertBefore(placeholder, panel);
        }
        opener = document.activeElement;
        if (!backdrop) {
          backdrop = document.createElement('div');
          backdrop.className = 'form-dialog-backdrop';
          backdrop.setAttribute('aria-hidden', 'true');
          backdrop.addEventListener('click', function () { controller.close(); });
        }
        if (!backdrop.isConnected) document.body.appendChild(backdrop);
        const origin = placeholder.parentNode;
        document.body.appendChild(panel);
        prepareDialog(panel, trigger, controller.close, origin);
        panel.classList.add('form-dialog-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', OPEN);
        controller.isOpen = true;
        document.documentElement.classList.add('form-dialog-open');
        setTimeout(function () {
          if (controller.isOpen) {
            backdrop.classList.add('is-visible');
            panel.classList.add('is-visible');
          }
        }, 20);

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

        panel.classList.remove('is-visible');
        if (backdrop) backdrop.classList.remove('is-visible');
        trigger.setAttribute('aria-expanded', CLOSED);
        controller.isOpen = false;
        document.documentElement.classList.remove('form-dialog-open');

        // Focus returns to the control that opened it, so keyboard and screen
        // reader users are not dropped at the top of the document.
        if (o.restoreFocus !== false) {
          const target = opener && opener.isConnected ? opener : trigger;
          target.focus({ preventScroll: true });
        }
        closeTimer = setTimeout(function () {
          panel.hidden = true;
          if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(panel, placeholder);
            placeholder.remove();
            placeholder = null;
          }
          if (backdrop) backdrop.remove();
          closeTimer = null;
        }, CLOSE_DELAY);
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
      if (!controller.isOpen) return;

      if (event.key === 'Escape') {
        // Do not steal Escape from an open dialog sitting on top of the form.
        const modal = document.querySelector('.modal[aria-modal="true"]');
        if (modal && modal.style.display !== 'none' && modal.style.display !== '') return;
        event.preventDefault();
        controller.close();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) { return element.getClientRects().length > 0; });
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    });

    return controller;
  }

  window.FormDisclosure = { attach: attach };
})();
