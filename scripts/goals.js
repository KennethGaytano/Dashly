/**
 * Goals Module
 * Keeps the milestone-checklist design; adds CRUD + localStorage.
 */

const STORAGE_KEY = 'dashboard_goals';

const GoalStatus = { ACTIVE: 'active', PAUSED: 'paused', COMPLETED: 'completed' };

let editingGoalId = null;
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

/* Restore original 4 cards when storage is empty, so the page never looks bare */
function seedDefaults() {
  const seed = [
    { id: generateId(), title: '🚀 Launch Portfolio Website', desc: 'Ship a polished personal portfolio with project showcases, blog, and contact form by end of October.', progress: 75, status: GoalStatus.ACTIVE, milestones: [
      { text: 'Design wireframes', done: true }, { text: 'Build responsive layout', done: true },
      { text: 'Add project showcase section', done: true }, { text: 'Write blog posts', done: false },
      { text: 'Deploy to production', done: false }
    ]},
    { id: generateId(), title: '📚 Master Data Structures', desc: 'Complete a full study cycle of core data structures and algorithms, solving 100 LeetCode problems.', progress: 45, status: GoalStatus.ACTIVE, milestones: [
      { text: 'Arrays & strings (20 problems)', done: true }, { text: 'Linked lists & stacks (15 problems)', done: true },
      { text: 'Trees & graphs (20 problems)', done: false }, { text: 'Dynamic programming (25 problems)', done: false },
      { text: 'Mock interview practice (20 problems)', done: false }
    ]},
    { id: generateId(), title: '💪 Fitness Consistency', desc: 'Exercise at least 4 times per week for 30 consecutive days.', progress: 100, status: GoalStatus.COMPLETED, milestones: [
      { text: 'Week 1 — 4 workouts', done: true }, { text: 'Week 2 — 5 workouts', done: true },
      { text: 'Week 3 — 4 workouts', done: true }, { text: 'Week 4 — 5 workouts', done: true }
    ]},
    { id: generateId(), title: '🦀 Learn Rust', desc: 'Work through The Rust Book and build a CLI tool as a capstone project.', progress: 15, status: GoalStatus.PAUSED, milestones: [
      { text: 'Read chapters 1–4', done: true }, { text: 'Read chapters 5–10', done: false },
      { text: 'Build CLI project', done: false }
    ]}
  ];
  saveGoals(seed);
  return seed;
}

function getGoalsWithSeed() {
  let g = getGoals();
  if (!g) g = seedDefaults();
  return g;
}

function createGoal(data) {
  if (!data.title || !data.title.trim()) return null;
  const goal = {
    id: generateId(),
    title: data.title.trim(),
    desc: (data.desc || '').trim(),
    progress: Math.min(100, Math.max(0, Math.round(Number(data.progress || 0)))),
    status: data.status || GoalStatus.ACTIVE,
    milestones: (data.milestones || []).map(m => ({ text: m.text, done: false })),
    createdAt: new Date().toISOString()
  };
  const goals = getGoalsWithSeed();
  goals.push(goal);
  saveGoals(goals);
  return goal;
}

function updateGoal(id, updates) {
  const goals = getGoalsWithSeed();
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

  goals[i] = { ...goals[i], ...updates, updatedAt: new Date().toISOString() };
  saveGoals(goals);
  return true;
}

function deleteGoal(id) {
  const goals = getGoalsWithSeed();
  const f = goals.filter(g => g.id !== id);
  if (f.length === goals.length) return false;
  saveGoals(f);
  return true;
}

/* Milestone toggle */
function toggleMilestone(goalId, idx) {
  const goals = getGoalsWithSeed();
  const g = goals.find(x => x.id === goalId);
  if (!g || !g.milestones || !g.milestones[idx]) return false;
  g.milestones[idx].done = !g.milestones[idx].done;
  // Recompute progress from milestones
  const done = g.milestones.filter(m => m.done).length;
  const total = g.milestones.length;
  g.progress = total ? Math.round((done / total) * 100) : g.progress;
  saveGoals(goals);
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
  const goals = getGoalsWithSeed();

  container.innerHTML = goals.map(goal => {
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
          <span class="goal-badge ${badgeClass(goal.status)}">${badgeLabel(goal.status)}</span>
          <button type="button" class="btn-icon" onclick="startEditGoal('${escapeHtml(goal.id)}')" aria-label="Edit ${escapeHtml(goal.title)}" title="Edit"><span aria-hidden="true">✏️</span></button>
          <button type="button" class="btn-icon danger" onclick="confirmDeleteGoal('${escapeHtml(goal.id)}')" aria-label="Delete ${escapeHtml(goal.title)}" title="Delete"><span aria-hidden="true">🗑️</span></button>
        </div>
      </div>
      ${goal.desc ? `<p class="goal-description">${escapeHtml(goal.desc)}</p>` : ''}
      <div class="progress-item" style="margin-bottom: 0.75rem;">
        <div class="progress-label"><span>Overall</span><span>${goal.progress}%</span></div>
        <div class="progress-bar" role="progressbar" aria-valuenow="${goal.progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall progress for ${escapeHtml(goal.title)}"><div class="progress-fill" style="width:${goal.progress}%;${goal.progress===100?'background:linear-gradient(90deg,var(--success),#6ee7b7);':''}"></div></div>
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
  if (ok) { f.reset(); const c = document.getElementById('milestoneRows'); if (c) { c.innerHTML = ''; addMilestoneRow(); } renderGoals(); showMessage(wasEdit ? 'Goal updated' : 'Goal added', 'success'); }
}
function startEditGoal(id) {
  const g = getGoalsWithSeed().find(x => x.id === id); if (!g) return; editingGoalId = id;
  document.getElementById('goalTitle').value = g.title;
  document.getElementById('goalDesc').value = g.desc || '';
  document.getElementById('goalProgress').value = g.progress;
  document.getElementById('goalStatus').value = g.status;
  // Load milestones
  const container = document.getElementById('milestoneRows');
  if (container) { container.innerHTML = ''; (g.milestones || []).forEach(m => addMilestoneRow(m.text)); if (!g.milestones || g.milestones.length === 0) addMilestoneRow(); }
  document.getElementById('formTitle').textContent = 'Edit Goal'; document.getElementById('submitBtn').textContent = 'Update Goal'; document.getElementById('cancelBtn').style.display = 'inline-flex'; document.getElementById('goalForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function cancelEdit() { editingGoalId = null; document.getElementById('goalForm').reset(); document.getElementById('formTitle').textContent = 'Add a Goal'; document.getElementById('submitBtn').textContent = '+ Add Goal'; document.getElementById('cancelBtn').style.display = 'none'; }
function confirmDeleteGoal(id) { const g = getGoalsWithSeed().find(x => x.id === id); if (!g) return; const modal = document.getElementById('confirmModal'); document.getElementById('confirmMessage').textContent = `Are you sure you want to delete "${g.title}"?`; modalOpener = document.activeElement; modal.style.display = 'flex'; modal.dataset.goalId = id; document.getElementById('cancelModal').focus(); }
function handleConfirmDelete() { const modal = document.getElementById('confirmModal'); const id = modal.dataset.goalId; if (id && deleteGoal(id)) { if (editingGoalId === id) cancelEdit(); renderGoals(); } closeModal(); }
function closeModal() { const m = document.getElementById('confirmModal'); if (!m || m.style.display === 'none') return; m.style.display = 'none'; delete m.dataset.goalId; if (modalOpener && document.contains(modalOpener)) modalOpener.focus(); modalOpener = null; }
function trapModalFocus(e) { if (e.key !== 'Tab') return; const m = document.getElementById('confirmModal'); if (!m || m.style.display === 'none') return; const focusable = Array.from(m.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
function addMilestoneRow(value = '') {
  const container = document.getElementById('milestoneRows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'milestone-row';
  row.innerHTML = `<input type="text" name="milestones[]" placeholder="Milestone..." value="${escapeHtml(value)}" class="form-input-inline"><button type="button" onclick="removeMilestoneRow(this)" aria-label="Remove milestone" class="btn-icon danger">✕</button>`;
  container.appendChild(row);
}
window.addMilestoneRow = addMilestoneRow;

function removeMilestoneRow(btn) {
  const row = btn.closest('.milestone-row');
  if (row) row.remove();
}
window.removeMilestoneRow = removeMilestoneRow;

function showMessage(msg, type='info') { const t = document.getElementById('toast'); if (!t) return console.log(`${type}: ${msg}`); t.textContent = msg; t.className = `toast toast-${type} show`; setTimeout(() => t.classList.remove('show'), 3000); }
window.startEditGoal = startEditGoal; window.confirmDeleteGoal = confirmDeleteGoal; window.handleToggleMilestone = toggleMilestone;

function init() {
  renderGoals();
  const f = document.getElementById('goalForm'); if (f) f.addEventListener('submit', handleFormSubmit);
  const c = document.getElementById('cancelBtn'); if (c) { c.addEventListener('click', cancelEdit); c.style.display = 'none'; }
  const nb = document.getElementById('newGoalBtn'); if (nb) nb.addEventListener('click', () => { const form = document.getElementById('goalForm'); if (editingGoalId) cancelEdit(); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('goalTitle').focus(); });
  const m = document.getElementById('confirmModal'); if (m) {
    const cm = document.getElementById('cancelModal'), df = document.getElementById('confirmDelete');
    if (cm) cm.addEventListener('click', closeModal);
    if (df) df.addEventListener('click', handleConfirmDelete);
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = document.getElementById('confirmModal'); if (m && m.style.display !== 'none') closeModal(); return; } trapModalFocus(e); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
