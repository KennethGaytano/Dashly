(function() {
  'use strict';

  const STORAGE_KEY = 'dashly-theme';
  const root = document.documentElement;

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function readTheme() {
    try {
      const savedTheme = window.localStorage.getItem(STORAGE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
    } catch (error) {
      console.error('Unable to read the saved appearance preference.', error);
    }
    return getSystemTheme();
  }

  function updateControls(theme) {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    const icon = nextTheme === 'light' ? '☀' : '☾';
    const label = nextTheme === 'light' ? 'Light' : 'Dark';

    document.querySelectorAll('.theme-toggle').forEach((button) => {
      const iconElement = button.querySelector('.theme-toggle-icon');
      const labelElement = button.querySelector('.theme-toggle-label');
      if (iconElement) iconElement.textContent = icon;
      if (labelElement) labelElement.textContent = label;
      button.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
    });
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    updateControls(theme);
  }

  function setTheme(theme) {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      console.error('Unable to save the appearance preference.', error);
    }
  }

  applyTheme(readTheme());

  function init() {
    updateControls(root.dataset.theme);
    document.querySelectorAll('.theme-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
