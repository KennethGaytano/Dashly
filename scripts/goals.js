/**
 * Goals Module
 * Keeps the milestone-checklist design; adds CRUD + localStorage.
 */

const STORAGE_KEY = 'dashboard_goals';

const GoalStatus = { ACTIVE: 'active', PAUSED: 'paused', COMPLETED: 'completed' };

let editingGoalId = null;

// The add/edit form, revealed by the "+ New Goal" button. Assigned in init.
let goalFormDisclosure = null;
let modalOpener = null;

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2); }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }

function getGoals() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function saveGoals(goals) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(goals)); return true; } catch { return false; }
}

function getGoalsOrEmpty() {
  return getGoals() || [];
}

/**
 * Single source of truth for a goal's completion status.
 *
 * Milestones own progress and completion when present. Goals without milestones
 * use their manual percentage and status.
 */
function deriveStatus(goal, intendedStatus) {
  const milestones = goal.milestones || [];
  const doneCount = milestones.filter(m => m && m.done).length;
  const progress = Math.min(100, Math.max(0, Math.round(Number(goal.progress || 0))));
  const hasMilestones = milestones.length > 0;
  const isComplete = hasMilestones ? doneCount >= milestones.length : progress >= 100;

  if (isComplete) return GoalStatus.COMPLETED;
  if (intendedStatus === GoalStatus.PAUSED) return GoalStatus.PAUSED;
  if (!hasMilestones && intendedStatus === GoalStatus.COMPLETED) return GoalStatus.COMPLETED;
  return GoalStatus.ACTIVE;
}

function createGoal(data) {
  if (!data.title || !data.title.trim()) return null;
  const milestones = (data.milestones || []).map(m => ({ text: m.text.trim(), done: false }));
  const requestedStatus = data.status || GoalStatus.ACTIVE;
  const goal = {
    id: generateId(),
    title: data.title.trim(),
    desc: (data.desc || '').trim(),
    progress: milestones.length
      ? 0
      : requestedStatus === GoalStatus.COMPLETED
        ? 100
        : Math.min(100, Math.max(0, Math.round(Number(data.progress || 0)))),
    status: requestedStatus,
    milestones: milestones,
    createdAt: new Date().toISOString()
  };
  goal.status = deriveStatus(goal, goal.status);
  const goals = getGoalsOrEmpty();
  goals.push(goal);
  if (!saveGoals(goals)) {
    showMessage('Failed to save goal. Storage may be full.', 'error');
    return null;
  }
  return goal;
}

function updateGoal(id, updates) {
  const goals = getGoalsOrEmpty();
  const i = goals.findIndex(g => g.id === id);
  if (i === -1) return false;
  if (updates.title !== undefined && (!updates.title || !updates.title.trim())) return false;
  if (updates.title) updates.title = updates.title.trim();
  if (updates.desc !== undefined) updates.desc = updates.desc.trim();

  // The form only edits milestone text, so carry each row's completed state
  // over from the goal being edited, matching on position in the list.
  if (updates.milestones !== undefined) {
    const previous = goals[i].milestones || [];
    updates.milestones = updates.milestones.map((m, idx) => ({
      text: m.text.trim(),
      done: previous[idx] ? !!previous[idx].done : false
    }));
  }

  // Milestones drive the progress bar once a goal has any, so a text-only
  // edit that leaves them all incomplete would otherwise report 0%.
  if (updates.milestones !== undefined && updates.milestones.length) {
    const done = updates.milestones.filter(m => m.done).length;
    updates.progress = Math.round((done / updates.milestones.length) * 100);
  } else if (updates.progress !== undefined) {
    updates.progress = Math.min(100, Math.max(0, Math.round(Number(updates.progress))));
  }
  if ((!updates.milestones || updates.milestones.length === 0) && updates.status === GoalStatus.COMPLETED) {
    updates.progress = 100;
  }

  // Reconcile the badge with reality: all milestones done (or 100% with no
  // milestones) means Completed, and anything less honours the chosen status.
  const merged = { ...goals[i], ...updates };
  updates.status = deriveStatus(merged, updates.status);

  goals[i] = { ...goals[i], ...updates, updatedAt: new Date().toISOString() };
  if (!saveGoals(goals)) {
    showMessage('Failed to save goal. Storage may be full.', 'error');
    return false;
  }
  return true;
}

function deleteGoal(id) {
  const goals = getGoalsOrEmpty();
  const f = goals.filter(g => g.id !== id);
  if (f.length === goals.length) return false;
  if (!saveGoals(f)) {
    showMessage('Failed to save goal. Storage may be full.', 'error');
    return false;
  }
  return true;
}

/* Milestone toggle */
function toggleMilestone(goalId, idx) {
  const goals = getGoalsOrEmpty();
  const g = goals.find(x => x.id === goalId);
  if (!g || !g.milestones || !g.milestones[idx]) return false;
  g.milestones[idx].done = !g.milestones[idx].done;
  // Recompute progress from milestones
  const done = g.milestones.filter(m => m.done).length;
  const total = g.milestones.length;
  g.progress = total ? Math.round((done / total) * 100) : g.progress;
  // Re-derive rather than passing the old status through: a goal that just
  // lost a milestone must fall back to Active, not stay stuck as Completed.
  g.status = deriveStatus(g, g.status === GoalStatus.COMPLETED ? null : g.status);
  if (!saveGoals(goals)) {
    showMessage('Failed to save goal. Storage may be full.', 'error');
    return false;
  }
  renderGoals();
  return true;
}

function badgeClass(status) {
  return status === GoalStatus.COMPLETED ? 'badge-completed' : status === GoalStatus.PAUSED ? 'badge-paused' : 'badge-active';
}

function badgeLabel(status) {
  return status === GoalStatus.COMPLETED ? 'Completed' : status === GoalStatus.PAUSED ? 'Paused' : 'Active';
}

function renderGoals() {
  const container = document.getElementById('goalsList');
  if (!container) return;
  const goals = getGoalsOrEmpty();
  if (goals.length === 0) {
    container.innerHTML = '<p class="empty-state"><span class="empty-icon" aria-hidden="true">🎯</span> No goals yet. Pick one meaningful outcome to work toward. <button type="button" class="btn btn-primary" onclick="document.getElementById(&quot;newGoalBtn&quot;).click()">Create your first goal</button></p>';
    return;
  }

  container.innerHTML = goals.map(goal => {
    const milestones = goal.milestones || [];
    const doneMilestones = milestones.filter(m => m && m.done).length;
    const progress = milestones.length
      ? Math.round((doneMilestones / milestones.length) * 100)
      : Math.min(100, Math.max(0, Math.round(Number(goal.progress || 0))));
    const status = deriveStatus(goal, goal.status);
    const msHtml = (goal.milestones || []).map((m, idx) => {
      const cls = m.done ? 'milestone done' : 'milestone';
      const sr = m.done ? '<span class="sr-only">Completed: </span>' : '<span class="sr-only">Not completed: </span>';
      return `<div class="${cls}" onclick="handleToggleMilestone('${escapeHtml(goal.id)}', ${idx})" style="cursor:pointer;" role="button" aria-label="${m.done ? 'Mark incomplete' : 'Mark complete'}: ${escapeHtml(m.text)}" tabindex="0">${sr}<span class="milestone-check" aria-hidden="true"></span><span>${escapeHtml(m.text)}</span></div>`;
    }).join('');

    return `
    <div class="goal-card" data-goal-id="${escapeHtml(goal.id)}">
      <div class="goal-header">
        <h3>${escapeHtml(goal.title)}</h3>
        <div class="goal-header-actions">
          <span class="goal-badge ${badgeClass(status)}">${badgeLabel(status)}</span>
          <button type="button" class="btn-icon" onclick="startEditGoal('${escapeHtml(goal.id)}')" aria-label="Edit ${escapeHtml(goal.title)}" title="Edit"><span aria-hidden="true">✏️</span></button>
          <button type="button" class="btn-icon danger" onclick="confirmDeleteGoal('${escapeHtml(goal.id)}')" aria-label="Delete ${escapeHtml(goal.title)}" title="Delete"><span aria-hidden="true">🗑️</span></button>
        </div>
      </div>
      ${goal.desc ? `<p class="goal-description">${escapeHtml(goal.desc)}</p>` : ''}
      <div class="progress-item" style="margin-bottom: 0.75rem;">
        <div class="progress-label"><span>${milestones.length ? `${doneMilestones} of ${milestones.length} milestones` : 'Manual progress'}</span><span>${progress}%</span></div>
        <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall progress for ${escapeHtml(goal.title)}"><div class="progress-fill" style="width:${progress}%;${progress===100?'background:linear-gradient(90deg,var(--success),#6ee7b7);':''}"></div></div>
      </div>
      <div class="goal-milestones">${msHtml}</div>
    </div>`;
  }).join('');
}

/* Form / edit / delete / modal — same patterns as tasks.js */
function handleFormSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const ms = [];
  document.querySelectorAll('#milestoneRows input[name="milestones[]"]').forEach(inp => { const v = inp.value.trim(); if (v) ms.push({ text: v, done: false }); });
  const data = { title: f.title.value, desc: f.desc.value, progress: f.progress.value, status: f.status.value, milestones: ms };
  let ok = false;
  const wasEdit = !!editingGoalId;
  if (editingGoalId) { ok = updateGoal(editingGoalId, data); if (ok) cancelEdit(); } else { ok = createGoal(data) !== null; }
  // A successful add closes the form too. cancelEdit() already closed it on the
  // edit path, so this only bites the add path.
  if (ok && !wasEdit) closeGoalForm();
  if (ok) { f.reset(); const c = document.getElementById('milestoneRows'); if (c) { c.innerHTML = ''; addMilestoneRow(); } renderGoals(); showMessage(wasEdit ? 'Goal updated' : 'Goal added', 'success'); }
}
function startEditGoal(id) {
  const g = getGoalsOrEmpty().find(x => x.id === id); if (!g) return; editingGoalId = id;
  document.getElementById('goalTitle').value = g.title;
  document.getElementById('goalDesc').value = g.desc || '';
  document.getElementById('goalProgress').value = g.progress;
  document.getElementById('goalStatus').value = g.status;
  // Load milestones
  const container = document.getElementById('milestoneRows');
  if (container) { container.innerHTML = ''; (g.milestones || []).forEach(m => addMilestoneRow(m.text)); if (!g.milestones || g.milestones.length === 0) addMilestoneRow(); }
  document.getElementById('formTitle').textContent = 'Edit Goal'; document.getElementById('submitBtn').textContent = 'Update Goal';
  // Editing reveals the form, exactly as "+ New Goal" does. open() scrolls and
  // honours reduced motion, replacing the old scrollIntoView call.
  if (goalFormDisclosure) { goalFormDisclosure.open({ focus: false }); goalFormDisclosure.trigger.textContent = '✎ Editing…'; }
}
function cancelEdit() {
  editingGoalId = null;
  document.getElementById('goalForm').reset();
  const rows = document.getElementById('milestoneRows');
  if (rows) { rows.innerHTML = ''; addMilestoneRow(); }
  document.getElementById('formTitle').textContent = 'Add a Goal';
  document.getElementById('submitBtn').textContent = '+ Add Goal';
  syncManualProgress();
  closeGoalForm();
}
/** Put the form away and restore the trigger's resting label. */
function closeGoalForm() { if (!goalFormDisclosure) return; goalFormDisclosure.close(); goalFormDisclosure.trigger.textContent = '+ New Goal'; }
function confirmDeleteGoal(id) { const g = getGoalsOrEmpty().find(x => x.id === id); if (!g) return; const modal = document.getElementById('confirmModal'); document.getElementById('confirmMessage').textContent = `Are you sure you want to delete "${g.title}"?`; modalOpener = document.activeElement; modal.style.display = 'flex'; modal.dataset.goalId = id; document.getElementById('cancelModal').focus(); }
function handleConfirmDelete() {
  const modal = document.getElementById('confirmModal');
  const id = modal.dataset.goalId;
  if (id && deleteGoal(id)) {
    if (editingGoalId === id) cancelEdit();
    renderGoals();
    showMessage('Goal deleted successfully', 'success');
  } else {
    showMessage('Goal not found', 'error');
  }
  closeModal();
}
function closeModal() { const m = document.getElementById('confirmModal'); if (!m || m.style.display === 'none') return; m.style.display = 'none'; delete m.dataset.goalId; if (modalOpener && document.contains(modalOpener)) modalOpener.focus(); modalOpener = null; }
function trapModalFocus(e) { if (e.key !== 'Tab') return; const m = document.getElementById('confirmModal'); if (!m || m.style.display === 'none') return; const focusable = Array.from(m.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
function addMilestoneRow(value = '') {
  const container = document.getElementById('milestoneRows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'milestone-row';
  row.innerHTML = `<input type="text" name="milestones[]" placeholder="Milestone..." value="${escapeHtml(value)}" class="form-input-inline"><button type="button" onclick="removeMilestoneRow(this)" aria-label="Remove milestone" class="btn-icon danger">✕</button>`;
  container.appendChild(row);
  syncManualProgress();
}
window.addMilestoneRow = addMilestoneRow;

function removeMilestoneRow(btn) {
  const row = btn.closest('.milestone-row');
  if (row) row.remove();
  syncManualProgress();
}
window.removeMilestoneRow = removeMilestoneRow;

function syncManualProgress() {
  const progress = document.getElementById('goalProgress');
  const help = document.getElementById('goalProgressHelp');
  const hasMilestones = Array.from(document.querySelectorAll('#milestoneRows input[name="milestones[]"]'))
    .some(input => input.value.trim());
  if (progress) progress.disabled = hasMilestones;
  if (help) help.textContent = hasMilestones
    ? 'Progress is calculated from the milestone checklist.'
    : 'Add milestones to calculate progress from completed steps. Leave milestones blank to set progress manually.';
}

function showMessage(msg, type='info') { const t = document.getElementById('toast'); if (!t) return console.log(`${type}: ${msg}`); t.textContent = msg; t.className = `toast toast-${type} show`; setTimeout(() => t.classList.remove('show'), 3000); }
window.startEditGoal = startEditGoal; window.confirmDeleteGoal = confirmDeleteGoal; window.handleToggleMilestone = toggleMilestone;

function init() {
  // The form starts collapsed, revealed by "+ New Goal". The trigger lives in
  // the My Goals header, next to the list it adds to.
  goalFormDisclosure = window.FormDisclosure
    ? window.FormDisclosure.attach(
        document.getElementById('newGoalBtn'),
        document.getElementById('goalFormPanel'),
        { focusTarget: '#goalTitle' }
      )
    : null;
  renderGoals();
  const f = document.getElementById('goalForm'); if (f) f.addEventListener('submit', handleFormSubmit);
  const milestoneRows = document.getElementById('milestoneRows');
  if (milestoneRows) milestoneRows.addEventListener('input', syncManualProgress);
  syncManualProgress();
  // Cancel is always visible now: the form is a disclosure, so whenever it is
  // on screen the user may have typed something to discard. Collapsing the
  // panel is what takes Cancel away.
  const c = document.getElementById('cancelBtn'); if (c) c.addEventListener('click', cancelEdit);
  // "+ New Goal" is the disclosure trigger, so FormDisclosure already toggles it
  // on click. This extra listener runs after that toggle and only handles the
  // one thing the toggle cannot know about: an edit left in progress, which has
  // to be abandoned. It resets to add-mode without closing, because the toggle
  // has just opened the panel.
  const nb = document.getElementById('newGoalBtn');
  if (nb) nb.addEventListener('click', () => {
    if (!editingGoalId) return;
    editingGoalId = null;
    document.getElementById('goalForm').reset();
    document.getElementById('formTitle').textContent = 'Add a Goal';
    document.getElementById('submitBtn').textContent = '+ Add Goal';
    const rows = document.getElementById('milestoneRows');
    if (rows) { rows.innerHTML = ''; addMilestoneRow(); }
    syncManualProgress();
    nb.textContent = '+ New Goal';
  });

  const m = document.getElementById('confirmModal'); if (m) {
    const cm = document.getElementById('cancelModal'), df = document.getElementById('confirmDelete');
    if (cm) cm.addEventListener('click', closeModal);
    if (df) df.addEventListener('click', handleConfirmDelete);
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = document.getElementById('confirmModal'); if (m && m.style.display !== 'none') closeModal(); return; } trapModalFocus(e); });
}
window.addEventListener('dashly:remote-update', event => {
  if (event.detail && event.detail.collection === 'goals') renderGoals();
});

if (window.DashlyCloud) window.DashlyCloud.start(init);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
