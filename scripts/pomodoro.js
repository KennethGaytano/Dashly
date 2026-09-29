/**
 * Pomodoro Timer
 * Focus (25 min) / Break (5 min) mode with start, pause, reset
 */
(function() {
  const STORAGE_KEY = 'pomodoro_state';
  let timerInterval = null;
  let remaining = 25 * 60; // default focus
  let isRunning = false;
  let mode = 'focus'; // 'focus' | 'break'

  const DURATIONS = { focus: 25 * 60, break: 5 * 60 };
  const SESSION_KEY = 'dashboard_pomodoro_sessions';
  let sessionLogged = false;
  let sessionStartedAt = null;

  function saveSessions(sessions) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch { /* ignore */ } }
  function getSessions() { try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }

  function logFocusSession() {
    if (sessionLogged) return;
    const started = sessionStartedAt || Date.now();
    const completed = Date.now();
    const minutes = Math.max(1, Math.round((completed - started) / 60000));
    const s = getSessions();
    s.push({ id: generateId(), mode: 'focus', startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), minutes });
    saveSessions(s);
    sessionLogged = true;
    sessionStartedAt = null;
  }

  function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

  function getState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, remaining, isRunning, sessionStartedAt }));
    } catch { /* ignore */ }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateDisplay() {
    const display = document.querySelector('.timer-display');
    if (display) display.textContent = formatTime(remaining);
    const btn = document.querySelector('.timer-buttons button:first-child');
    if (btn) btn.textContent = isRunning ? '⏸ Pause' : '▶ Start';
    const input = document.querySelector('#minuteInput');
    if (input) input.value = Math.round(remaining / 60);
  }

  function tick() {
    if (!isRunning) return;
    if (remaining > 0) {
      remaining -= 1;
      updateDisplay();
      saveState();
    } else {
      if (mode === 'focus' && isRunning && !sessionLogged) { logFocusSession(); }
      clearInterval(timerInterval);
      timerInterval = null;
      isRunning = false;
      updateDisplay();
      saveState();
    }
  }

  function startTimer() {
    if (isRunning) return;
    sessionLogged = false;
    sessionStartedAt = Date.now();
    isRunning = true;
    timerInterval = setInterval(tick, 1000);
    updateDisplay();
    saveState();
  }

  function pauseTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    updateDisplay();
    saveState();
  }

  function resetTimer() {
    pauseTimer();
    sessionLogged = false;
    sessionStartedAt = null;
    remaining = DURATIONS[mode];
    updateDisplay();
    saveState();
  }

  function switchMode(newMode) {
    sessionLogged = false;
    sessionStartedAt = null;
    mode = newMode;
    remaining = DURATIONS[mode];
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    updateDisplay();
    saveState();
    // Update button active state
    document.querySelectorAll('.mode-btn').forEach(b => {
      const active = b.textContent.trim() === (mode === 'focus' ? 'Focus' : 'Break');
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function init() {
    const state = getState();
    if (state) {
      mode = state.mode || 'focus';
      remaining = state.remaining || DURATIONS[mode];
      isRunning = state.isRunning || false;
      sessionStartedAt = typeof state.sessionStartedAt === 'number' ? state.sessionStartedAt : null;
    } else {
      mode = 'focus';
      remaining = DURATIONS.focus;
    }

    updateDisplay();

    const btn = document.querySelector('.timer-buttons button:first-child');
    if (btn) {
      btn.onclick = () => { if (isRunning) pauseTimer(); else startTimer(); };
    }
    const resetBtn = document.querySelector('.timer-buttons button:last-child');
    if (resetBtn) resetBtn.onclick = resetTimer;

    document.querySelectorAll('.mode-btn').forEach(b => {
      b.onclick = () => {
        const target = b.textContent.trim() === 'Focus' ? 'focus' : 'break';
        if (target !== mode) switchMode(target);
      };
    });

    const minuteInput = document.querySelector('#minuteInput');
    if (minuteInput) {
      minuteInput.addEventListener('change', () => {
        const mins = parseInt(minuteInput.value, 10);
        if (!isNaN(mins) && mins >= 1 && mins <= 120) {
          remaining = mins * 60;
          updateDisplay();
          saveState();
        }
      });
    }

    if (isRunning && remaining > 0) {
      timerInterval = setInterval(tick, 1000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
