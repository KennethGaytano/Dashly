/**
 * Pomodoro Timer
 * Focus / Break timer with elapsed-time tracking and local persistence.
 */
(function() {
  const STORAGE_KEY = 'pomodoro_state';
  const SESSION_KEY = 'dashboard_pomodoro_sessions';
  const DEFAULTS = { focus: 25 * 60, break: 5 * 60 };
  let timerInterval = null;
  let remaining = DEFAULTS.focus;
  let isRunning = false;
  let mode = 'focus';
  let configuredFocusDuration = DEFAULTS.focus;
  let configuredBreakDuration = DEFAULTS.break;
  let deadlineAt = null;
  let sessionStartedAt = null;
  let sessionElapsedMs = 0;
  let sessionSegmentStartedAt = null;
  let sessionLogged = false;
  let completionMode = null;
  const completionAudio = new Audio('assets/audio/pomodoro-alarm.wav');
  completionAudio.preload = 'auto';

  function saveSessions(sessions) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error('Error saving Pomodoro sessions:', error);
      announce('Session finished, but its history could not be saved.');
    }
  }

  function getSessions() {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      const sessions = stored ? JSON.parse(stored) : [];
      return Array.isArray(sessions) ? sessions : [];
    } catch (error) {
      console.error('Error loading Pomodoro sessions:', error);
      return [];
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function getDuration() {
    return mode === 'focus' ? configuredFocusDuration : configuredBreakDuration;
  }

  function setDuration(duration) {
    if (mode === 'focus') configuredFocusDuration = duration;
    else configuredBreakDuration = duration;
  }

  function getState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error('Error loading Pomodoro state:', error);
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode,
        remaining,
        isRunning,
        configuredFocusDuration,
        configuredBreakDuration,
        deadlineAt,
        sessionStartedAt,
        sessionElapsedMs,
        sessionSegmentStartedAt
      }));
    } catch (error) {
      console.error('Error saving Pomodoro state:', error);
      announce('Timer changes could not be saved.');
    }
  }

  function announce(message) {
    const status = document.getElementById('timerStatus');
    if (status) status.textContent = message;
  }

  function unlockCompletionAudio() {
    completionAudio.volume = 0;
    completionAudio.play()
      .then(() => {
        completionAudio.pause();
        completionAudio.currentTime = 0;
        completionAudio.volume = 1;
      })
      .catch(error => {
        completionAudio.volume = 1;
        console.warn('Pomodoro notification sound could not be unlocked.', error);
      });
  }

  function playCompletionSound() {
    completionMode = mode;
    const stopButton = document.getElementById('stopPomodoroAlarm');
    if (stopButton) stopButton.hidden = false;
    completionAudio.loop = true;
    completionAudio.currentTime = 0;
    completionAudio.volume = 1;
    completionAudio.play().catch(error => {
      console.error('Pomodoro completion sound could not play:', error);
      completionAudio.loop = false;
      if (stopButton) stopButton.hidden = true;
      announce('Timer complete. The notification sound could not be played.');
    });
  }

  function stopCompletionSound() {
    completionAudio.pause();
    completionAudio.currentTime = 0;
    completionAudio.loop = false;
    const stopButton = document.getElementById('stopPomodoroAlarm');
    if (stopButton) stopButton.hidden = true;
    const switchToBreak = completionMode === 'focus';
    completionMode = null;
    if (switchToBreak) switchMode('break');
    else announce('Alarm stopped.');
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function updateRemainingFromClock() {
    if (!isRunning || !Number.isFinite(deadlineAt)) return;
    remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  }

  function updateDisplay() {
    const display = document.querySelector('.timer-display');
    if (display) {
      display.textContent = formatTime(remaining);
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      display.setAttribute('aria-label',
        `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'} remaining`);
    }

    const startButton = document.querySelector('.timer-buttons button:first-child');
    if (startButton) startButton.textContent = isRunning ? '⏸ Pause' : '▶ Start';

    const input = document.querySelector('#minuteInput');
    if (input && document.activeElement !== input) {
      input.value = Math.round(getDuration() / 60);
    }
    const durationLabel = document.querySelector('label[for="minuteInput"]');
    if (durationLabel) durationLabel.textContent = `${mode === 'focus' ? 'Focus' : 'Break'} minutes`;

    const progress = document.getElementById('timerProgress');
    if (progress) {
      const duration = getDuration();
      progress.max = duration;
      progress.value = Math.max(0, duration - remaining);
      progress.setAttribute('aria-valuetext', `${Math.round(progress.value / 60)} of ${Math.round(duration / 60)} minutes`);
    }

    const settings = document.querySelector('.duration-setting');
    if (settings) {
      settings.querySelectorAll('input, button').forEach(control => {
        control.disabled = isRunning;
      });
    }
  }

  function finishTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    remaining = 0;
    deadlineAt = null;

    if (mode === 'focus' && !sessionLogged) logFocusSession();

    sessionStartedAt = null;
    sessionElapsedMs = 0;
    sessionSegmentStartedAt = null;
    updateDisplay();
    saveState();
    announce(mode === 'focus'
      ? 'Focus session complete. Take a break when you are ready.'
      : 'Break complete. Ready to focus again?');
    playCompletionSound();
  }

  function tick() {
    if (!isRunning) return;
    updateRemainingFromClock();
    updateDisplay();
    if (remaining === 0) {
      finishTimer();
      return;
    }
  }

  function startTimer() {
    if (isRunning) return;
    unlockCompletionAudio();
    if (remaining === 0) remaining = getDuration();

    const now = Date.now();
    if (mode === 'focus') {
      if (sessionStartedAt === null) sessionStartedAt = now;
      sessionSegmentStartedAt = now;
    }
    deadlineAt = now + remaining * 1000;
    isRunning = true;
    sessionLogged = false;
    timerInterval = setInterval(tick, 1000);
    updateDisplay();
    saveState();
    announce(`${mode === 'focus' ? 'Focus' : 'Break'} started.`);
  }

  function pauseTimer() {
    if (!isRunning) return;
    updateRemainingFromClock();
    if (mode === 'focus' && sessionSegmentStartedAt !== null) {
      sessionElapsedMs += Math.max(0, Date.now() - sessionSegmentStartedAt);
      sessionSegmentStartedAt = null;
    }
    if (remaining === 0) {
      finishTimer();
      return;
    }
    isRunning = false;
    deadlineAt = null;
    clearInterval(timerInterval);
    timerInterval = null;
    updateDisplay();
    saveState();
    announce('Timer paused.');
  }

  function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    remaining = getDuration();
    deadlineAt = null;
    sessionStartedAt = null;
    sessionElapsedMs = 0;
    sessionSegmentStartedAt = null;
    sessionLogged = false;
    updateDisplay();
    saveState();
    announce('Timer reset.');
  }

  function switchMode(newMode) {
    if (newMode === mode) return;
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    mode = newMode;
    remaining = getDuration();
    deadlineAt = null;
    sessionStartedAt = null;
    sessionElapsedMs = 0;
    sessionSegmentStartedAt = null;
    sessionLogged = false;
    updateDisplay();
    saveState();

    document.querySelectorAll('.mode-btn').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    announce(mode === 'focus' ? 'Focus timer ready.' : 'Break timer ready.');
  }

  function applyModeDuration() {
    const input = document.querySelector('#minuteInput');
    const minutes = input ? Number.parseInt(input.value, 10) : NaN;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
      announce('Choose a duration between 1 and 120 minutes.');
      return;
    }

    if (input) input.removeAttribute('aria-invalid');
    setDuration(minutes * 60);
    remaining = getDuration();
    updateDisplay();
    saveState();
    document.querySelector('.duration-settings')?.removeAttribute('open');
    announce(`${mode === 'focus' ? 'Focus' : 'Break'} duration set to ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  function logFocusSession() {
    if (sessionLogged) return;

    const completedAt = Date.now();
    const activeDuration = sessionElapsedMs +
      (sessionSegmentStartedAt === null ? 0 : Math.max(0, completedAt - sessionSegmentStartedAt));
    const sessions = getSessions();
    sessions.push({
      id: generateId(),
      mode: 'focus',
      startedAt: new Date(sessionStartedAt || completedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      minutes: Math.max(1, Math.round(activeDuration / 60000))
    });
    saveSessions(sessions);
    sessionLogged = true;
  }

  function init() {
    const state = getState();
    let timerExpiredOnLoad = false;
    if (state) {
      mode = state.mode === 'break' ? 'break' : 'focus';
      configuredFocusDuration = Number.isInteger(state.configuredFocusDuration) &&
        state.configuredFocusDuration >= 60 && state.configuredFocusDuration <= 7200
        ? state.configuredFocusDuration
        : DEFAULTS.focus;
      configuredBreakDuration = Number.isInteger(state.configuredBreakDuration) &&
        state.configuredBreakDuration >= 60 && state.configuredBreakDuration <= 7200
        ? state.configuredBreakDuration
        : DEFAULTS.break;
      remaining = Number.isFinite(state.remaining)
        ? Math.max(0, Math.min(state.remaining, getDuration()))
        : getDuration();
      isRunning = state.isRunning === true && remaining > 0;
      deadlineAt = Number.isFinite(state.deadlineAt) ? state.deadlineAt : null;
      sessionStartedAt = Number.isFinite(state.sessionStartedAt) ? state.sessionStartedAt : null;
      sessionElapsedMs = Number.isFinite(state.sessionElapsedMs) ? state.sessionElapsedMs : 0;
      sessionSegmentStartedAt = Number.isFinite(state.sessionSegmentStartedAt)
        ? state.sessionSegmentStartedAt
        : null;

      if (isRunning) {
        if (deadlineAt === null) deadlineAt = Date.now() + remaining * 1000;
        if (mode === 'focus' && sessionSegmentStartedAt === null) {
          sessionSegmentStartedAt = Date.now();
        }
        updateRemainingFromClock();
        timerExpiredOnLoad = remaining === 0;
      } else {
        deadlineAt = null;
        sessionSegmentStartedAt = null;
      }
    }

    document.querySelectorAll('.mode-btn').forEach(button => {
      button.dataset.mode = button.textContent.trim().toLowerCase();
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', () => switchMode(button.dataset.mode));
    });

    const startButton = document.querySelector('.timer-buttons button:first-child');
    if (startButton) startButton.addEventListener('click', () => {
      if (isRunning) pauseTimer();
      else startTimer();
    });

    const resetButton = document.querySelector('.timer-buttons button:last-child');
    if (resetButton) resetButton.addEventListener('click', resetTimer);

    const stopAlarmButton = document.getElementById('stopPomodoroAlarm');
    if (stopAlarmButton) stopAlarmButton.addEventListener('click', stopCompletionSound);

    const applyButton = document.getElementById('setDurationBtn');
    if (applyButton) applyButton.addEventListener('click', applyModeDuration);

    const minuteInput = document.querySelector('#minuteInput');
    if (minuteInput) {
      minuteInput.addEventListener('input', () => minuteInput.removeAttribute('aria-invalid'));
      minuteInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') applyModeDuration();
      });
    }

    updateDisplay();
    if (timerExpiredOnLoad) {
      finishTimer();
    } else if (isRunning) {
      timerInterval = setInterval(tick, 1000);
      tick();
      if (isRunning) saveState();
    } else if (state && state.remaining === 0) {
      announce(mode === 'focus'
        ? 'Focus session complete. Take a break when you are ready.'
        : 'Break complete. Ready to focus again?');
    }
  }

  window.addEventListener('dashly:remote-update', event => {
    if (event.detail && event.detail.collection === 'pomodoro_state') {
      const updatedState = getState();
      if (!updatedState) return;
      if (timerInterval) clearInterval(timerInterval);
      mode = updatedState.mode === 'break' ? 'break' : 'focus';
      configuredFocusDuration = Number.isInteger(updatedState.configuredFocusDuration) &&
        updatedState.configuredFocusDuration >= 60 && updatedState.configuredFocusDuration <= 7200
        ? updatedState.configuredFocusDuration : DEFAULTS.focus;
      configuredBreakDuration = Number.isInteger(updatedState.configuredBreakDuration) &&
        updatedState.configuredBreakDuration >= 60 && updatedState.configuredBreakDuration <= 7200
        ? updatedState.configuredBreakDuration : DEFAULTS.break;
      remaining = Number.isFinite(updatedState.remaining)
        ? Math.max(0, Math.min(updatedState.remaining, getDuration())) : getDuration();
      isRunning = updatedState.isRunning === true && remaining > 0;
      deadlineAt = Number.isFinite(updatedState.deadlineAt) ? updatedState.deadlineAt : null;
      sessionStartedAt = Number.isFinite(updatedState.sessionStartedAt) ? updatedState.sessionStartedAt : null;
      sessionElapsedMs = Number.isFinite(updatedState.sessionElapsedMs) ? updatedState.sessionElapsedMs : 0;
      sessionSegmentStartedAt = Number.isFinite(updatedState.sessionSegmentStartedAt)
        ? updatedState.sessionSegmentStartedAt : null;
      sessionLogged = false;
      updateRemainingFromClock();
      updateDisplay();
      if (isRunning) {
        if (remaining === 0) finishTimer();
        else timerInterval = setInterval(tick, 1000);
      }
    }
  });
  if (window.DashlyCloud) window.DashlyCloud.start(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
