/**
 * Home Page Task Sync
 * Displays actual tasks from localStorage on the home page
 */

(function() {
  const STORAGE_KEY = 'dashboard_tasks';
  let refreshTimeoutId = null;

  /**
   * Get tasks from localStorage
   */
  function getTasks() {
    try {
      const tasks = localStorage.getItem(STORAGE_KEY);
      return tasks ? JSON.parse(tasks) : [];
    } catch (error) {
      console.error('Error loading tasks:', error);
      return [];
    }
  }

  /**
   * Update the task count in the overview stat card
   */
  function updateTaskCount() {
    const tasks = getTasks();
    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const totalCount = tasks.length;

    // Target the Tasks card specifically, not whichever card renders first
    const taskCard = Array.from(document.querySelectorAll('.stat-card'))
      .find(card => {
        const heading = card.querySelector('h3');
        return heading && heading.textContent.trim() === 'Tasks';
      });

    if (taskCard) {
      const value = taskCard.querySelector('.stat-value');
      if (value) {
        value.textContent = `${completedCount}/${totalCount}`;
      }
    }
  }

  /**
   * Parse a task's date-only deadline in the visitor's local time.
   */
  function parseDueDate(dateString) {
    if (!dateString) return null;

    const date = new Date(`${dateString}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Get the moment a task is due. A date without a time is due at the end
   * of that local calendar day.
   */
  function getTaskDueAt(task) {
    if (!task.dueDate) return null;

    const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(task.dueTime || '');
    const dueTime = timeMatch ? task.dueTime : '23:59:59.999';
    const dueAt = new Date(`${task.dueDate}T${dueTime}`);
    return isNaN(dueAt.getTime()) ? null : dueAt;
  }

  /**
   * Check whether a task is due today, without comparing the time of day.
   */
  function isTaskDueToday(task) {
    const dueDate = parseDueDate(task.dueDate);
    if (!dueDate) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate.getTime() === today.getTime();
  }

  /**
   * Sort tasks with deadlines first, using the earliest deadline as the
   * tie-breaker. Tasks without a deadline remain at the end.
   */
  function compareTaskDeadlines(firstTask, secondTask) {
    const firstDueAt = getTaskDueAt(firstTask);
    const secondDueAt = getTaskDueAt(secondTask);

    if (firstDueAt && secondDueAt) {
      return firstDueAt.getTime() - secondDueAt.getTime();
    }
    if (firstDueAt) return -1;
    if (secondDueAt) return 1;
    return 0;
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
   * The home page task list. The render and the checkbox listener must
   * resolve the same element, so they share this lookup instead of querying
   * separately and silently drifting apart.
   */
  function getHomeTaskList() {
    return document.getElementById('homeTaskList') || document.querySelector('.task-list');
  }

  /**
   * Render today's tasks on the home page
   */
  function renderHomeTasks() {
    const tasks = getTasks();
    const container = getHomeTaskList();

    if (!container) {
      console.error('Home task list container not found');
      return;
    }

    const displayTasks = tasks
      .filter(task => task.status !== 'completed' && isTaskDueToday(task))
      .sort(compareTaskDeadlines);

    if (displayTasks.length === 0) {
      container.innerHTML = '<p class="empty-state">Nothing due today. <a class="section-link" href="pages/tasks.html">View all tasks</a></p>';
      return;
    }

    container.innerHTML = displayTasks.map(task => `
      <div class="task-item ${task.status === 'completed' ? 'completed' : ''}">
        <input
          type="checkbox"
          data-task-id="${escapeHtml(task.id)}"
          ${task.status === 'completed' ? 'checked' : ''}
          aria-label="Mark task ${escapeHtml(task.title)} as ${task.status === 'completed' ? 'incomplete' : 'complete'}"
        >
        <div class="task-content">
          <div class="task-header">
            <span class="task-text">${escapeHtml(task.title)}</span>
            ${overdueWarning(task)}
            ${task.priority ? `<span class="task-priority priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>` : ''}
          </div>
          ${formatDueDateTime(task) ? `<p class="task-due-date">${formatDueDateTime(task)}</p>` : ''}
          ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
          ${(function() {
            const link = normalizeLink(task.url || '');
            return link ? `<a class="task-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open link for ${escapeHtml(task.title)} (opens in a new tab)">${escapeHtml(displayLink(link))}</a>` : '';
          })()}
        </div>
      </div>
    `).join('');
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
   * Format a date as Today, Tomorrow, or a readable date
   */
  function formatDate(dateString) {
    const date = parseDueDate(dateString);
    if (!date) return '';

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Reset time so only the calendar day is compared
    today.setHours(0, 0, 0, 0);
    tomorrow.setHours(0, 0, 0, 0);

    if (date.getTime() === today.getTime()) {
      return 'Today';
    } else if (date.getTime() === tomorrow.getTime()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /**
   * Format an HTML time value in the visitor's local time format
   */
  function formatTime(timeString) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeString || '');
    if (!match) return '';

    const date = new Date();
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * A task is overdue once its due moment has passed and it is still open.
   * With no due time, the deadline is the end of the due day.
   */
  function isTaskOverdue(task) {
    if (task.status === 'completed') return false;

    const dueAt = getTaskDueAt(task);
    return dueAt ? dueAt.getTime() < Date.now() : false;
  }

  /**
   * Deadline line for a task, or nothing when it has no due date
   */
  function formatDueDateTime(task) {
    if (!task.dueDate) return '';

    const formattedTime = formatTime(task.dueTime);
    return `Due: ${formatDate(task.dueDate)}${formattedTime ? ` at <span class="task-due-time">${formattedTime}</span>` : ''}`;
  }

  /**
   * Warning text shown on overdue tasks
   */
  function overdueWarning(task) {
    return isTaskOverdue(task)
      ? `<span class="task-overdue"><span aria-hidden="true">⚠</span> Overdue</span>`
      : '';
  }

  /**
   * Toggle task status from the home page, then re-render so the overdue
   * warning and the task count reflect the new status immediately.
   * Reached through a delegated listener rather than an inline onchange,
   * which a strict CSP would block.
   */
  function toggleHomeTask(taskId) {
    const tasks = getTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      return;
    }

    // Toggle status
    task.status = task.status === 'completed' ? 'todo' : 'completed';
    task.updatedAt = new Date().toISOString();
    task.completedAt = task.status === 'completed' ? task.updatedAt : '';

    // Save back to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      // Re-render
      renderHomeTasks();
      updateTaskCount();
    } catch (error) {
      console.error('Error updating task:', error);
    }
  }

  /**
   * Greet the user according to the time of day, by name when we know it
   */
  function setGreeting() {
    const heading = document.getElementById('greeting');
    if (!heading) return;

    const hour = new Date().getHours();
    let salutation;
    let icon;

    if (hour < 12) {
      salutation = 'Good morning';
      icon = '☀️';
    } else if (hour < 18) {
      salutation = 'Good afternoon';
      icon = '🌤️';
    } else {
      salutation = 'Good evening';
      icon = '🌙';
    }

    const cloud = window.DashlyCloud;
    const name = cloud?.username || cloud?.firstName || '';
    const greeting = name
      ? `${salutation}, ${escapeHtml(name)}!`
      : `${salutation}!`;

    heading.innerHTML = `${greeting} <span aria-hidden="true">${icon}</span>`;
  }

  /**
   * Re-render time-sensitive task state and schedule the next minute boundary.
   */
  function refreshTaskState() {
    renderHomeTasks();
    updateTaskCount();
    scheduleTaskStateRefresh();
  }

  /**
   * Refresh just after the next minute so newly passed due times are shown
   * as overdue without requiring a page reload.
   */
  function scheduleTaskStateRefresh() {
    if (refreshTimeoutId !== null) {
      clearTimeout(refreshTimeoutId);
    }

    const now = new Date();
    const delay = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 10;
    refreshTimeoutId = setTimeout(refreshTaskState, delay);
  }

  /**
   * Sync the home Projects stat to the stored project count
   */
  function updateProjectCount() {
    try {
      const STORAGE_PROJECTS = 'dashboard_projects';
      function readStorage(k) { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; } }
      const p = readStorage(STORAGE_PROJECTS) || [];
      const count = Array.isArray(p) ? p.length : 0;
      const el = document.getElementById('homeProjects');
      if (el) el.textContent = String(count);
    } catch (e) { /* leave static */ }
  }

  /**
   * Derive study hours/minutes from focus sessions (same rolling 7-day window as progress)
   */
  function updateStudyTime() {
    try {
      const STORAGE_SESSIONS = 'dashboard_pomodoro_sessions';
      function readStorage(k) { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; } }
      function localKey(d) { d = d || new Date(); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + day; }
      const today = new Date(); const keys = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); keys.push(localKey(d)); }
      const sessions = readStorage(STORAGE_SESSIONS) || [];
      let minutes = 0;
      sessions.forEach(function(s) { if (s && s.mode === 'focus' && s.completedAt) { const d = new Date(s.completedAt); if (!isNaN(d.getTime()) && keys.indexOf(localKey(d)) !== -1) minutes += (typeof s.minutes === 'number' ? s.minutes : 0); } });
      const h = Math.floor(minutes / 60); const m = minutes % 60;
      const el = document.getElementById('homeStudyTime');
      if (el) el.textContent = h + 'h ' + String(m).padStart(2, '0') + 'm';
    } catch (e) { /* leave static */ }
  }

  /**
   * Sync the home page Streak stat to the derived progress-module value
   */
  function updateStreak() {
    const streakEl = document.getElementById('homeStreak') || document.querySelector('.stat-card a[href="pages/progress.html"] .stat-value');
    if (!streakEl) return;
    try {
      // Derive from progress module's computeStats logic (no dependency, mirror formula)
      const STORAGE_TASKS = 'dashboard_tasks';
      const STORAGE_SESSIONS = 'dashboard_pomodoro_sessions';
      function readStorage(k) { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; } }
      function localKey(d) { d = d || new Date(); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + day; }
      const tasks = readStorage(STORAGE_TASKS) || [];
      const sessions = readStorage(STORAGE_SESSIONS) || [];
      const activityDays = {};
      tasks.forEach(function(t) { if (t && t.status === 'completed' && (t.updatedAt || t.createdAt)) { const d = new Date(t.updatedAt || t.createdAt); if (!isNaN(d.getTime())) activityDays[localKey(d)] = true; } });
      sessions.forEach(function(s) { if (s && s.mode === 'focus' && s.completedAt) { const d = new Date(s.completedAt); if (!isNaN(d.getTime())) activityDays[localKey(d)] = true; } });
      let streak = 0; const startDay = new Date(); const hasToday = !!activityDays[localKey(startDay)];
      if (!hasToday) startDay.setDate(startDay.getDate() - 1);
      for (let i = 0; i < 30; i++) { const d = new Date(startDay); d.setDate(startDay.getDate() - i); if (activityDays[localKey(d)]) streak++; else break; }
      streakEl.textContent = streak + ' day' + (streak !== 1 ? 's' : '');
    } catch (e) { /* leave static if anything fails */ }
  }

  /**
   * Recompute every stat card derived from localStorage.
   * Called on load and whenever the tab regains focus.
   */
  function refreshHomeStats() {
    updateProjectCount();
    updateStudyTime();
    updateStreak();
  }

  function init() {
    setGreeting();
    renderHomeTasks();
    updateTaskCount();
    refreshHomeStats();
    scheduleTaskStateRefresh();

    // Delegate checkbox changes instead of inline onchange (fixes CSP / a11y).
    // Bound to the container so it survives the innerHTML re-renders.
    const taskList = getHomeTaskList();
    if (taskList) {
      taskList.addEventListener('change', e => {
        const cb = e.target.closest('input[type="checkbox"][data-task-id]');
        if (cb) toggleHomeTask(cb.getAttribute('data-task-id'));
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshTaskState();
        refreshHomeStats();
      }
    });
  }

  window.addEventListener('dashly:remote-update', event => {
    const collection = event.detail && event.detail.collection;
    if (collection === 'tasks') {
      renderHomeTasks();
      updateTaskCount();
      updateStreak();
    }
    if (collection === 'projects') updateProjectCount();
    if (collection === 'pomodoro_sessions') {
      updateStudyTime();
      updateStreak();
    }
  });

  if (window.DashlyCloud) window.DashlyCloud.start(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
