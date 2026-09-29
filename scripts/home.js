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

  /**
   * Render today's tasks on the home page
   */
  function renderHomeTasks() {
    const tasks = getTasks();
    const container = document.querySelector('.task-list');

    if (!container) {
      return; // Not on home page
    }

    // Include completed tasks in ranking so finished work stays visible
    const allTasks = tasks;

    // Put overdue and due-today tasks first, then fill any remaining slots
    // with future, undated, or completed tasks.
    const priorityTasks = tasks
      .filter(task => (isTaskOverdue(task) || isTaskDueToday(task)) && task.status !== 'completed')
      .sort(compareTaskDeadlines);
    const fallbackTasks = tasks
      .filter(task => task.status !== 'completed' && !isTaskOverdue(task) && !isTaskDueToday(task))
      .sort(compareTaskDeadlines);
    const completedTasks = tasks
      .filter(task => task.status === 'completed')
      .sort(compareTaskDeadlines);

    // Show at most 3 tasks in total. Completed tasks are ranked last but
    // still earn a slot, so a finished task stays visible on the home page.
    const MAX_TASKS = 3;
    const displayTasks = [
      ...priorityTasks,
      ...fallbackTasks,
      ...completedTasks
    ].slice(0, MAX_TASKS);

    if (displayTasks.length === 0) {
      container.innerHTML = '<p class="empty-state">No tasks yet. <a href="pages/tasks.html">Create your first task</a></p>';
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
   * Toggle task status from home page
   * Exported on window for the shared task page, but home.js binds its own
   * delegated listener instead of an inline onchange, which a strict CSP
   * would block.
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

  // The task page still calls this through an inline handler, so keep it
  // reachable there.
  window.toggleHomeTask = toggleHomeTask;

  /**
   * Greet the user according to the time of day
   */
  function setGreeting() {
    const heading = document.getElementById('greeting');
    if (!heading) return;

    const hour = new Date().getHours();
    let greeting;
    let icon;

    if (hour < 12) {
      greeting = 'Good morning!';
      icon = '☀️';
    } else if (hour < 18) {
      greeting = 'Good afternoon!';
      icon = '🌤️';
    } else {
      greeting = 'Good evening!';
      icon = '🌙';
    }

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
   * Initialize home page task display
   */
  function init() {
    setGreeting();
    renderHomeTasks();
    updateTaskCount();
    scheduleTaskStateRefresh();

    // Delegate checkbox changes instead of inline onchange (fixes CSP / a11y).
    document.getElementById('homeTaskList')?.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"][data-task-id]');
      if (cb) toggleHomeTask(cb.getAttribute('data-task-id'));
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshTaskState();
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
