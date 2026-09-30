/**
 * Task Management Module
 * Handles CRUD operations, localStorage persistence, and UI updates
 */

// Task storage key
const STORAGE_KEY = 'dashboard_tasks';

// Task status enum
const TaskStatus = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

// Task priority enum
const TaskPriority = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

// Current edit state
let editingTaskId = null;

// Element focused before the modal opened, restored on close
let modalOpener = null;

// The add/edit form, revealed by the "+ Add Task" button. Assigned in init.
let taskFormDisclosure = null;

/**
 * Generate unique ID for tasks
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Get all tasks from localStorage
 *
 * The stored value is whatever a previous version of the app, a hand edit in
 * devtools, or a partial write left behind, so the shape is verified here
 * rather than assumed. Both checks below were real crashes: an object or a
 * string instead of an array made renderTasks call .filter on a non-array, and
 * a null inside the array made the status grouping read .status of null. Both
 * threw an uncaught TypeError and left the page with no task list at all.
 */
function getTasks() {
  try {
    const tasks = localStorage.getItem(STORAGE_KEY);
    if (!tasks) return [];

    const parsed = JSON.parse(tasks);
    if (!Array.isArray(parsed)) {
      console.error('Stored tasks are not an array; ignoring them.');
      return [];
    }

    // Drop anything that is not an object with an id, rather than letting it
    // reach the render loop.
    return parsed.filter(t => t && typeof t === 'object' && t.id);
  } catch (error) {
    console.error('Error loading tasks:', error);
    return [];
  }
}

/**
 * Save tasks to localStorage
 */
function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch (error) {
    console.error('Error saving tasks:', error);
    showMessage('Failed to save tasks. Storage may be full.', 'error');
    return false;
  }
}

/**
 * Create a new task
 */
function createTask(taskData) {
  // Validate required fields
  if (!taskData.title || !taskData.title.trim()) {
    showMessage('Task title is required', 'error');
    return null;
  }

  const task = {
    id: generateId(),
    title: taskData.title.trim(),
    description: taskData.description ? taskData.description.trim() : '',
    url: taskData.url ? taskData.url.trim() : '',
    dueDate: taskData.dueDate || '',
    dueTime: taskData.dueDate && taskData.dueTime ? taskData.dueTime : '',
    status: taskData.status || TaskStatus.TODO,
    priority: taskData.priority || TaskPriority.MEDIUM,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const tasks = getTasks();
  tasks.push(task);

  if (saveTasks(tasks)) {
    showMessage('Task added successfully', 'success');
    return task;
  }

  return null;
}

/**
 * Update an existing task
 */
function updateTask(taskId, updates) {
  const tasks = getTasks();
  const index = tasks.findIndex(t => t.id === taskId);

  if (index === -1) {
    showMessage('Task not found', 'error');
    return false;
  }

  // Validate title if being updated
  if (updates.title !== undefined && (!updates.title || !updates.title.trim())) {
    showMessage('Task title cannot be empty', 'error');
    return false;
  }

  // Sanitize string fields
  if (updates.title) updates.title = updates.title.trim();
  if (updates.description !== undefined) {
    updates.description = updates.description.trim();
  }
  if (updates.url !== undefined) {
    updates.url = updates.url.trim();
  }

  tasks[index] = {
    ...tasks[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  if (saveTasks(tasks)) {
    showMessage('Task updated successfully', 'success');
    return true;
  }

  return false;
}

/**
 * Delete a task
 */
function deleteTask(taskId) {
  const tasks = getTasks();
  const filteredTasks = tasks.filter(t => t.id !== taskId);

  if (tasks.length === filteredTasks.length) {
    showMessage('Task not found', 'error');
    return false;
  }

  if (saveTasks(filteredTasks)) {
    showMessage('Task deleted successfully', 'success');
    return true;
  }

  return false;
}

/**
 * Toggle task completion status
 */
function toggleTaskStatus(taskId) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    return false;
  }

  const newStatus = task.status === TaskStatus.COMPLETED
    ? TaskStatus.TODO
    : TaskStatus.COMPLETED;

  return updateTask(taskId, { status: newStatus });
}

/**
 * Escape a string for safe interpolation into an HTML template.
 * Values are stored raw; escaping happens only at render time.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function taskLinkHtml(task) {
  const link = normalizeLink(task.url);
  if (!link) return '';
  return `<a class="task-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Open link for ${escapeHtml(task.title)} (opens in a new tab)">${escapeHtml(displayLink(link))}</a>`;
}

/**
 * Render all tasks
 */
function renderTasks() {
  const tasks = getTasks();

  // Group by status. A task whose status is missing or unrecognised used to
  // match none of the three filters and simply disappeared from the page,
  // which reads as data loss. Unknown statuses now fall into To Do; the three
  // known ones keep their own lists, so nothing is duplicated.
  const KNOWN = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED];
  const todoTasks = tasks.filter(t => t.status === TaskStatus.TODO || !KNOWN.includes(t.status));
  const inProgressTasks = tasks.filter(t => t.status === TaskStatus.IN_PROGRESS);
  const completedTasks = tasks.filter(t => t.status === TaskStatus.COMPLETED);

  renderTaskSection('todoList', todoTasks, 'No tasks to do');
  renderTaskSection('inProgressList', inProgressTasks, 'No tasks in progress');
  renderTaskSection('completedList', completedTasks, 'No completed tasks');
}

/**
 * Render a task section
 */
function renderTaskSection(containerId, tasks, emptyMessage) {
  const container = document.getElementById(containerId);

  if (!container) {
    console.error(`Container ${containerId} not found`);
    return;
  }

  if (tasks.length === 0) {
    container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
    return;
  }

  container.innerHTML = tasks.map(task => `
    <div class="task-item ${task.status === TaskStatus.COMPLETED ? 'completed' : ''}" data-task-id="${escapeHtml(task.id)}">
      <input
        type="checkbox"
        ${task.status === TaskStatus.COMPLETED ? 'checked' : ''}
        onchange="handleToggleTask('${escapeHtml(task.id)}')"
        aria-label="Mark task ${escapeHtml(task.title)} as ${task.status === TaskStatus.COMPLETED ? 'incomplete' : 'complete'}"
      >
      <div class="task-content">
        <div class="task-header">
          <span class="task-text">${escapeHtml(task.title)}</span>
          ${overdueWarning(task)}
          ${task.priority ? `<span class="task-priority priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>` : ''}
          <div class="task-actions">
            <button
              type="button"
              class="btn-icon"
              onclick="startEditTask('${escapeHtml(task.id)}')"
              aria-label="Edit task ${escapeHtml(task.title)}"
              title="Edit"
            ><span aria-hidden="true">✏️</span></button>
            <button
              type="button"
              class="btn-icon danger"
              onclick="confirmDeleteTask('${escapeHtml(task.id)}')"
              aria-label="Delete task ${escapeHtml(task.title)}"
              title="Delete"
            ><span aria-hidden="true">🗑️</span></button>
          </div>
        </div>
        ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ''}
        ${taskLinkHtml(task)}
        ${formatDueDateTime(task) ? `<p class="task-due-date">${formatDueDateTime(task)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Reset time for comparison
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  tomorrow.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) {
    return 'Today';
  } else if (date.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Format a task's due date and optional time for display
 */
function formatDueDateTime(task) {
  if (!task.dueDate) return '';

  const formattedTime = formatTime(task.dueTime);
  return `Due: ${formatDate(task.dueDate)}${formattedTime ? ` at <span class="task-due-time">${formattedTime}</span>` : ''}`;
}

/**
 * A task is overdue once its due moment has passed and it is still open.
 * With no due time, the deadline is the end of the due day, so a task due
 * today is not overdue until midnight.
 */
function isTaskOverdue(task) {
  if (!task.dueDate || task.status === TaskStatus.COMPLETED) return false;

  if (task.dueTime) {
    const dueAt = new Date(`${task.dueDate}T${task.dueTime}`);
    if (isNaN(dueAt.getTime())) return false;
    return dueAt.getTime() < Date.now();
  }

  const endOfDueDay = new Date(`${task.dueDate}T23:59:59.999`);
  if (isNaN(endOfDueDay.getTime())) return false;
  return endOfDueDay.getTime() < Date.now();
}

/**
 * Warning text shown on overdue tasks. Marked up as text rather than an
 * icon so screen readers announce the state instead of skipping it.
 */
function overdueWarning(task) {
  return isTaskOverdue(task)
    ? `<span class="task-overdue"><span aria-hidden="true">⚠</span> Overdue</span>`
    : '';
}

/**
 * Format an HTML time value in the visitor's local time format
 */
function formatTime(timeString) {
  if (!timeString) return '';

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeString);
  if (!match) return '';

  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Enable the due time only when the task has a due date
 */
function syncDueTimeAvailability() {
  const dueDateInput = document.getElementById('taskDueDate');
  const dueTimeInput = document.getElementById('taskDueTime');

  if (!dueDateInput || !dueTimeInput) return;

  dueTimeInput.disabled = !dueDateInput.value;
  if (!dueDateInput.value) {
    dueTimeInput.value = '';
  }
}

/**
 * Handle form submission
 */
function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const rawUrl = form.url ? form.url.value.trim() : '';

  // Optional, but a typed-and-unusable link is a mistake worth reporting
  // rather than silently dropping.
  if (rawUrl && !normalizeLink(rawUrl)) {
    showMessage('That link is not a valid web address', 'error');
    if (form.url) {
      form.url.setAttribute('aria-invalid', 'true');
      form.url.focus();
    }
    return;
  }
  if (form.url) form.url.removeAttribute('aria-invalid');

  const formData = {
    title: form.title.value,
    description: form.description.value,
    url: normalizeLink(rawUrl) || '',
    dueDate: form.dueDate.value,
    dueTime: form.dueDate.value ? form.dueTime.value : '',
    status: form.status.value,
    priority: form.priority.value
  };

  let success = false;

  if (editingTaskId) {
    success = updateTask(editingTaskId, formData);
    if (success) {
      cancelEdit();
    }
  } else {
    const task = createTask(formData);
    success = task !== null;
  }

  if (success) {
    form.reset();
    syncDueTimeAvailability();
    renderTasks();
    // A successful add closes the form too; cancelEdit() already closed it on
    // the edit path, so this only bites here.
    if (!editingTaskId && taskFormDisclosure) {
      taskFormDisclosure.close();
      taskFormDisclosure.trigger.textContent = '+ Add Task';
    }
  }
}

/**
 * Start editing a task
 */
function startEditTask(taskId) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    showMessage('Task not found', 'error');
    return;
  }

  editingTaskId = taskId;

  // Populate form
  document.getElementById('taskTitle').value = task.title;
  document.getElementById('taskDescription').value = task.description || '';
  const urlInput = document.getElementById('taskUrl');
  if (urlInput) urlInput.value = task.url || '';
  document.getElementById('taskDueDate').value = task.dueDate || '';
  document.getElementById('taskDueTime').value = task.dueTime || '';
  document.getElementById('taskStatus').value = task.status;
  document.getElementById('taskPriority').value = task.priority;
  syncDueTimeAvailability();

  // Update form UI
  document.getElementById('formTitle').textContent = 'Edit Task';
  document.getElementById('submitBtn').textContent = 'Update Task';

  // Editing an existing task reveals the form, exactly as the Add button does.
  // No scrollIntoView here: open() handles that and honours reduced motion.
  if (taskFormDisclosure) {
    taskFormDisclosure.open({ focus: false });
    taskFormDisclosure.trigger.textContent = '✎ Editing…';
  }
}

/**
 * Cancel editing
 */
function cancelEdit() {
  editingTaskId = null;

  // Reset form
  document.getElementById('taskForm').reset();
  syncDueTimeAvailability();
  document.getElementById('formTitle').textContent = 'Add a Task';
  document.getElementById('submitBtn').textContent = '+ Add Task';

  // Cancel is not hidden here. The form is a disclosure now, so it is open and
  // the user may have typed something they want to discard. It collapses the
  // panel, which is what removes Cancel from view anyway.
  if (taskFormDisclosure) {
    taskFormDisclosure.close();
    taskFormDisclosure.trigger.textContent = '+ Add Task';
  }
}

/**
 * Handle checkbox toggle
 */
function handleToggleTask(taskId) {
  if (toggleTaskStatus(taskId)) {
    renderTasks();
  }
}

/**
 * Confirm task deletion
 */
function confirmDeleteTask(taskId) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    return;
  }

  // Show confirmation modal
  const modal = document.getElementById('confirmModal');
  const message = document.getElementById('confirmMessage');

  message.textContent = `Are you sure you want to delete "${task.title}"? This action cannot be undone.`;

  // Remember who opened it so focus can be restored on close
  modalOpener = document.activeElement;

  modal.style.display = 'flex';

  // Store taskId for confirmation
  modal.dataset.taskId = taskId;

  // Move focus into the dialog; the safe default is Cancel
  const cancelBtn = document.getElementById('cancelModal');
  if (cancelBtn) {
    cancelBtn.focus();
  }
}

// Expose functions globally for inline event handlers
window.handleToggleTask = handleToggleTask;
window.startEditTask = startEditTask;
window.confirmDeleteTask = confirmDeleteTask;

/**
 * Handle delete confirmation
 */
function handleConfirmDelete() {
  const modal = document.getElementById('confirmModal');
  const taskId = modal.dataset.taskId;

  if (taskId && deleteTask(taskId)) {
    // Cancel edit if deleting the task being edited
    if (editingTaskId === taskId) {
      cancelEdit();
    }
    renderTasks();
  }

  closeModal();
}

/**
 * Close modal
 */
function closeModal() {
  const modal = document.getElementById('confirmModal');
  if (!modal || modal.style.display === 'none') return;

  modal.style.display = 'none';
  delete modal.dataset.taskId;

  // Return focus to the control that opened the dialog
  if (modalOpener && document.contains(modalOpener)) {
    modalOpener.focus();
  }
  modalOpener = null;
}

/**
 * Keep Tab cycling inside the open dialog
 */
function trapModalFocus(event) {
  if (event.key !== 'Tab') return;

  const modal = document.getElementById('confirmModal');
  if (!modal || modal.style.display === 'none') return;

  const focusable = Array.from(
    modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(el => el.offsetParent !== null);

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

/**
 * Show message to user
 */
function showMessage(message, type = 'info') {
  const toast = document.getElementById('toast');

  if (!toast) {
    console.log(`${type.toUpperCase()}: ${message}`);
    return;
  }

  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Initialize the task management system
 */
function initTaskManager() {
  // The form starts collapsed. Everything below assumes the disclosure exists
  // before any edit or cancel can run.
  taskFormDisclosure = window.FormDisclosure
    ? window.FormDisclosure.attach(
        document.getElementById('newTaskBtn'),
        document.getElementById('taskFormPanel'),
        { focusTarget: '#taskTitle' }
      )
    : null;

  // Render initial tasks
  renderTasks();

  // Set up form submission
  const form = document.getElementById('taskForm');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);

    const dueDateInput = document.getElementById('taskDueDate');
    if (dueDateInput) {
      dueDateInput.addEventListener('input', syncDueTimeAvailability);
      dueDateInput.addEventListener('change', syncDueTimeAvailability);
      syncDueTimeAvailability();
    }
  }

  // Cancel stays visible in both modes. See the note in cancelEdit().
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelEdit);
  }

  // Set up modal close handlers
  const modal = document.getElementById('confirmModal');
  if (modal) {
    const cancelModalBtn = document.getElementById('cancelModal');
    const confirmDeleteBtn = document.getElementById('confirmDelete');

    if (cancelModalBtn) {
      cancelModalBtn.addEventListener('click', closeModal);
    }

    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', handleConfirmDelete);
    }

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }

  // Escape closes the dialog; Tab cycles within it while open
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const modal = document.getElementById('confirmModal');
      if (modal && modal.style.display !== 'none') {
        closeModal();
      }
      return;
    }
    trapModalFocus(event);
  });

  console.log('Task manager initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTaskManager);
} else {
  initTaskManager();
}
