/**
 * Progress Module — Goals-only read view. No seeds, no writes.
 * Wrapped IIFE to avoid collision with goals.js globals.
 */
(function() {
  'use strict';
  const STORAGE_TASKS = 'dashboard_tasks';
  const STORAGE_SESSIONS = 'dashboard_pomodoro_sessions';
  const STORAGE_GOALS = 'dashboard_goals';
  const STORAGE_SKILLS = 'dashboard_skills';
  const STORAGE_PROJECTS = 'dashboard_projects';

  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = (str == null ? '' : String(str)); return d.innerHTML; }

  function readStorage(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function writeStorage(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  }

  const PROGRESS_STEPS = [0, 25, 50, 60, 70, 80, 90, 100];

  function snapToStep(value) {
    const v = Number(value);
    if (isNaN(v)) return PROGRESS_STEPS[0];
    let clamped = Math.min(100, Math.max(0, v));
    let nearest = PROGRESS_STEPS[0];
    let bestDist = Infinity;
    for (let i = 0; i < PROGRESS_STEPS.length; i++) {
      const step = PROGRESS_STEPS[i];
      const dist = Math.abs(step - clamped);
      if (dist < bestDist || (dist === bestDist && step > nearest)) {
        bestDist = dist; nearest = step;
      }
    }
    return nearest;
  }

  // ---- stats (unchanged derivation) ----
  function localKey(d) {
    d = d || new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function daysInWindow() {
    const today = new Date(); const keys = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); keys.push(localKey(d)); }
    return keys;
  }
  function computeStats() {
    const windowKeys = daysInWindow();
    const tasks = (readStorage(STORAGE_TASKS) || []);
    let doneTasks = 0;
    tasks.forEach(function(t) { if (t && t.status === 'completed' && (t.updatedAt || t.createdAt)) { const d = new Date(t.updatedAt || t.createdAt); if (!isNaN(d.getTime()) && windowKeys.indexOf(localKey(d)) !== -1) doneTasks++; } });
    const sessions = (readStorage(STORAGE_SESSIONS) || []);
    let focusMinutes = 0, focusCount = 0;
    sessions.forEach(function(s) { if (s && s.mode === 'focus' && s.completedAt) { const d = new Date(s.completedAt); if (!isNaN(d.getTime()) && windowKeys.indexOf(localKey(d)) !== -1) { focusCount++; focusMinutes += (typeof s.minutes === 'number' ? s.minutes : 0); } } });
    const hours = focusMinutes ? Math.round((focusMinutes / 60) * 10) / 10 : 0;
    let streak = 0;
    const activityDays = {};
    tasks.forEach(function(t) { if (t && t.status === 'completed' && (t.updatedAt || t.createdAt)) { const d = new Date(t.updatedAt || t.createdAt); if (!isNaN(d.getTime())) activityDays[localKey(d)] = true; } });
    sessions.forEach(function(s) { if (s && s.mode === 'focus' && s.completedAt) { const d = new Date(s.completedAt); if (!isNaN(d.getTime())) activityDays[localKey(d)] = true; } });
    const startDay = new Date(); const hasToday = !!activityDays[localKey(startDay)];
    if (!hasToday) startDay.setDate(startDay.getDate() - 1);
    for (let i = 0; i < 30; i++) { const d = new Date(startDay); d.setDate(startDay.getDate() - i); if (activityDays[localKey(d)]) streak++; else break; }
    return { doneTasks, hours: hours, pomodoros: focusCount, streak: streak };
  }
  function renderStats() {
    const s = computeStats();
    function setVal(id, val) { const el = document.getElementById(id); if (el) el.textContent = String(val); }
    setVal('statTasksDone', s.doneTasks);
    setVal('statHoursStudied', s.hours.toFixed(1));
    setVal('statPomodoros', s.pomodoros);
    setVal('statStreak', s.streak);
  }

  // ---- goals read-only render ----
  /**
   * Derive a goal's status from stored data so the sort order, the filter, and
   * the badge can never disagree with one another. This also rescues goals
   * already sitting in storage whose `status` was never written as 'completed'
   * when they finished -- which is what kept them out of the Completed filter.
   */
  function effectiveStatus(g) {
    const pct = Math.min(100, Math.max(0, Math.round(Number(g.progress || 0))));
    const ms = g.milestones || [];
    const allDone = ms.length > 0 && ms.every(m => m && m.done);
    if (g.status === 'completed' || pct >= 100 || allDone) return 'completed';
    if (g.status === 'paused') return 'paused';
    return 'active';
  }

  function renderGoals() {
    const container = document.getElementById('goalsProgressList');
    if (!container) return;
    const raw = readStorage(STORAGE_GOALS);
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      container.innerHTML = '<p class="empty-state"><span class="empty-icon" aria-hidden="true">🎯</span> No goals yet. <a href="goals.html" class="section-link">Create your first goal &rarr;</a></p>';
      document.getElementById('goalsSummary').textContent = '';
      return;
    }
    // Sort: active, paused, completed; within each: highest progress; stable by createdAt for ties
    const sorted = raw.slice().sort(function(a, b) {
      const order = { 'active': 0, 'paused': 1, 'completed': 2 };
      const aOrd = order[effectiveStatus(a)];
      const bOrd = order[effectiveStatus(b)];
      if (aOrd !== bOrd) return aOrd - bOrd;
      const aProg = Number(a.progress || 0);
      const bProg = Number(b.progress || 0);
      if (aProg !== bProg) return bProg - aProg; // highest first
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    // Summary is computed over ALL goals, independent of the active filter
    const total = sorted.length;
    const avg = total ? Math.round(sorted.reduce(function(sum, g) { return sum + Number(g.progress || 0); }, 0) / total) : 0;
    const summary = document.getElementById('goalsSummary');
    if (summary) summary.textContent = total + ' of ' + total + ' goals · ' + avg + '% average progress';

    const visible = currentFilter === 'all' ? sorted : sorted.filter(function(g) { return effectiveStatus(g) === currentFilter; });
    if (visible.length === 0) {
      container.innerHTML = '<p class="empty-state"><span class="empty-icon" aria-hidden="true">🎯</span> No ' + escapeHtml(currentFilter) + ' goals.</p>';
      return;
    }
    container.innerHTML = visible.map(function(g) {
      const pct = Math.min(100, Math.max(0, Math.round(Number(g.progress || 0))));
      const doneMs = (g.milestones || []).filter(function(m) { return m && m.done; }).length;
      const totalMs = (g.milestones || []).length;
      const milestoneLine = totalMs ? (doneMs + ' of ' + totalMs + ' milestones done') : '';
      const descHtml = (g.desc || '').trim() ? '<p class="goal-description">' + escapeHtml(g.desc) + '</p>' : '';
      const completeClass = pct === 100 ? 'fill-complete' : '';
      const status = effectiveStatus(g);
      const statusClass = status === 'completed' ? 'badge-completed' : status === 'paused' ? 'badge-paused' : 'badge-active';
      const statusLabel = status === 'completed' ? 'Completed' : status === 'paused' ? 'Paused' : 'Active';
      return '<div class="goal-card" data-goal-id="' + escapeHtml(g.id) + '">' +
        '<div class="goal-header"><h3>' + escapeHtml(g.title) + '</h3><span class="goal-badge ' + statusClass + '">' + statusLabel + '</span></div>' +
        descHtml +
        '<div class="progress-item" style="margin-bottom:0.75rem;"><div class="progress-label"><span>Overall</span><span>' + pct + '%</span></div>' +
        '<div class="progress-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + escapeHtml(g.title) + ' progress"><div class="progress-fill ' + completeClass + '" style="width:' + pct + '%;"></div></div></div>' +
        (milestoneLine ? '<div class="goal-milestones" style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.25rem;">' + escapeHtml(milestoneLine) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ---- filter (memory only, no write) ----
  let currentFilter = 'all';
  function applyFilter() {
    renderGoals();
    document.querySelectorAll('#filterRow button').forEach(function(btn) {
      btn.setAttribute('aria-pressed', btn.dataset.filter === currentFilter ? 'true' : 'false');
    });
  }
  function bindDelegation() {
    // Filter buttons
    const row = document.getElementById('filterRow');
    if (row) {
      row.addEventListener('click', function(e) {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        currentFilter = btn.dataset.filter;
        applyFilter();
      });
    }
    // Storage sync + visibility
    window.addEventListener('storage', function(e) { if (e.key === STORAGE_GOALS) { renderGoals(); renderStats(); } });
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') { renderGoals(); renderStats(); } });
  }

  function seedSkills() {
    const s = [
      {id:'sk1',name:'JavaScript',progress:70,type:'skill'},
      {id:'sk2',name:'Python',progress:50,type:'skill'},
      {id:'sk3',name:'Data Structures & Algorithms',progress:50,type:'skill'},
      {id:'sk4',name:'System Design',progress:25,type:'skill'},
      {id:'sk5',name:'CSS & Design',progress:90,type:'skill'}
    ];
    writeStorage(STORAGE_SKILLS, s); return s;
  }
  function seedProjects() {
    const p = [
      {id:'pj1',name:'Personal Dashboard',progress:50,type:'project'},
      {id:'pj2',name:'Portfolio Website',progress:90,type:'project'},
      {id:'pj3',name:'API Integration',progress:60,type:'project'}
    ];
    writeStorage(STORAGE_PROJECTS, p); return p;
  }
  function getSkills() { let s = readStorage(STORAGE_SKILLS); if (!s || !Array.isArray(s)) s = seedSkills(); return s; }
  function getProjects() { let p = readStorage(STORAGE_PROJECTS); if (!p || !Array.isArray(p)) p = seedProjects(); return p; }

  function renderSkills() {
    const container = document.getElementById('skillsList'); if (!container) return;
    const skills = getSkills(); const projects = getProjects();
    if ((!skills || skills.length === 0) && (!projects || projects.length === 0)) {
      container.innerHTML = '<p class="empty-state"><span class="empty-icon" aria-hidden="true">📊</span> No tracks yet. Add one above.</p>';
      return;
    }
    const all = (skills || []).concat(projects || []);
    container.innerHTML = all.map(function(item) {
      // Snap at display time only; never write back on load
      const rawPct = Number(item.progress || 0);
      const pct = snapToStep(rawPct);
      const idx = PROGRESS_STEPS.indexOf(pct);
      const totalSteps = PROGRESS_STEPS.length; // 8
      const readOut = 'Step ' + (idx + 1) + ' of ' + totalSteps + ' · ' + pct + '%';
      const cls = pct === 100 ? 'fill-complete' : '';
      const prevDisabled = pct === 0 ? 'disabled' : '';
      const nextDisabled = pct === 100 ? 'disabled' : '';
      const prevStep = PROGRESS_STEPS[idx > 0 ? idx - 1 : 0];
      const nextStep = PROGRESS_STEPS[idx < PROGRESS_STEPS.length - 1 ? idx + 1 : PROGRESS_STEPS.length - 1];

      return '<div class="progress-item" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="progress-label"><span>' + escapeHtml(item.name) + '</span><span>' + pct + '%</span></div>' +
        '<div class="progress-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-valuetext="' + readOut + '" aria-label="' + escapeHtml(item.name) + ' progress"><div class="progress-fill ' + cls + '" style="width:' + pct + '%;"></div></div>' +
        '<p class="ladder-readout" aria-hidden="true">' + escapeHtml(readOut) + '</p>' +
        '<div class="stepper">' +
        '<button type="button" data-dir="prev" data-track-id="' + escapeHtml(item.id) + '" aria-label="Decrease progress to ' + prevStep + '%" class="btn-icon" ' + prevDisabled + '><span aria-hidden="true">‹</span></button>' +
        '<button type="button" data-dir="next" data-track-id="' + escapeHtml(item.id) + '" aria-label="Increase progress to ' + nextStep + '%" class="btn-icon" ' + nextDisabled + '><span aria-hidden="true">›</span></button>' +
        '<button type="button" data-action="delete-skill" data-track-id="' + escapeHtml(item.id) + '" class="btn-icon danger stepper-delete" aria-label="Delete ' + escapeHtml(item.name) + '"><span aria-hidden="true">🗑️</span></button>' +
        '</div></div>';
    }).join('');
  }

  function populateProgressSelect() {
    const sel = document.getElementById('trackProgress');
    if (!sel) return;
    sel.innerHTML = PROGRESS_STEPS.map(function(s) {
      return '<option value="' + s + '">' + s + '%</option>';
    }).join('');
    sel.value = String(PROGRESS_STEPS[0]); // default to the first step (0%)
  }

  function showMessage(msg, type) {
    const t = document.getElementById('toast');
    if (!t) { console.log(type + ': ' + msg); return; }
    t.textContent = msg; t.className = 'toast toast-' + (type || 'info') + ' show';
    setTimeout(function() { t.classList.remove('show'); }, 3000);
  }

  // The add form starts collapsed, revealed by "+ Add Track". Tracks have no
  // edit path -- progress is changed with the stepper on each row -- so this is
  // purely an add-and-collapse disclosure.
  var trackFormDisclosure = window.FormDisclosure
    ? window.FormDisclosure.attach(
        document.getElementById('newTrackBtn'),
        document.getElementById('trackFormPanel'),
        { focusTarget: '#trackName' }
      )
    : null;

  function bindSkillsDelegation() {
    const form = document.getElementById('trackForm');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault(); const f = e.target;
        const name = (f.trackName || {}).value.trim(); const valStr = (f.trackProgress || {}).value; const pct = snapToStep(valStr);
        const type = (f.trackType || {}).value || 'skill';
        if (!name) return;
        const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), name: name, progress: pct, type: type };
        if (type === 'project') { const p = getProjects(); p.push(item); writeStorage(STORAGE_PROJECTS, p); }
        else { const s = getSkills(); s.push(item); writeStorage(STORAGE_SKILLS, s); }
        f.reset();
        // Put the form away again; focus returns to the trigger.
        if (trackFormDisclosure) trackFormDisclosure.close();
        renderSkills(); showMessage('Track added', 'success');
      });
    }
    // Cancel has no handler anywhere on this page, so give it one: it should
    // clear the fields and collapse the panel rather than do nothing.
    const trackCancel = document.getElementById('cancelBtn');
    if (trackCancel) {
      trackCancel.addEventListener('click', function() {
        const f = document.getElementById('trackForm');
        if (f) f.reset();
        populateProgressSelect();
        if (trackFormDisclosure) trackFormDisclosure.close();
      });
    }
    const list = document.getElementById('skillsList');
    if (list) {
      // Stepper delegation (prev/next)
      list.addEventListener('click', function(e) {
        const btn = e.target.closest('button[data-dir]');
        if (btn) {
          const id = btn.dataset.trackId; const dir = btn.dataset.dir;
          const all = (getSkills() || []).concat(getProjects() || []);
          const item = all.find(x => x.id === id); if (!item) return;
          const idx = PROGRESS_STEPS.indexOf(snapToStep(Number(item.progress || 0)));
          let newIdx = dir === 'prev' ? Math.max(0, idx - 1) : Math.min(PROGRESS_STEPS.length - 1, idx + 1);
          const newPct = PROGRESS_STEPS[newIdx];
          // Persist through snapToStep
          const snapped = snapToStep(newPct);
          if (item.type === 'project') { const p = getProjects(); const pi = p.findIndex(x => x.id === id); if (pi !== -1) { p[pi].progress = snapped; writeStorage(STORAGE_PROJECTS, p); } }
          else { const s = getSkills(); const si = s.findIndex(x => x.id === id); if (si !== -1) { s[si].progress = snapped; writeStorage(STORAGE_SKILLS, s); } }
          renderSkills(); showMessage('Progress updated', 'success');
          return;
        }
        // Delete via stepper-delete button
        const delBtnNew = e.target.closest('.stepper-delete');
        if (delBtnNew) {
          const id = delBtnNew.dataset.trackId;
          let s = getSkills(); s = s.filter(x => x.id !== id); writeStorage(STORAGE_SKILLS, s);
          let p = getProjects(); p = p.filter(x => x.id !== id); writeStorage(STORAGE_PROJECTS, p);
          renderSkills();
          return;
        }
        // Delete via legacy data-action (fallback)
        const delBtnOld = e.target.closest('[data-action="delete-skill"]');
        if (delBtnOld) {
          const id = delBtnOld.dataset.id;
          let s = getSkills(); s = s.filter(x => x.id !== id); writeStorage(STORAGE_SKILLS, s);
          let p = getProjects(); p = p.filter(x => x.id !== id); writeStorage(STORAGE_PROJECTS, p);
          renderSkills();
          return;
        }
      });
    }
  }

  function init() {
    populateProgressSelect();
    renderStats();
    renderGoals();
    renderSkills();
    bindDelegation();
    bindSkillsDelegation();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
