(function() {
  'use strict';

  const STORAGE_KEYS = {
    tasks: 'dashboard_tasks',
    events: 'dashboard_events',
    notes: 'dashboard_notes',
    goals: 'dashboard_goals',
    skills: 'dashboard_skills',
    projects: 'dashboard_projects',
    pomodoro_sessions: 'dashboard_pomodoro_sessions',
    pomodoro_state: 'pomodoro_state'
  };
  const USER_MARKER = 'dashly_cloud_user_id';
  const PENDING_KEY = 'dashly_cloud_pending_writes';
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  let currentUserId = null;
  let changeQueue = Promise.resolve();
  const syncTimers = new Map();
  let realtimeChannel = null;
  let initialSync = false;
  let client;
  let connectionPromise = null;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function showAuth(message, busy) {
    let root = document.getElementById('cloud-auth-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cloud-auth-root';
      root.innerHTML = [
        '<section class="cloud-auth-card" role="dialog" aria-modal="true" aria-labelledby="cloud-auth-title">',
        '<img src="' + (location.pathname.includes('/pages/') ? '../assets/brand/dashly-logo.svg' : 'assets/brand/dashly-logo.svg') + '" alt="Dashly" class="cloud-auth-logo">',
        '</section>'
      ].join('');
      document.body.appendChild(root);
    }
    const section = root.querySelector('.cloud-auth-card');
    if (!section.querySelector('#cloud-auth-form')) renderAuthForm(section);
    const messageEl = root.querySelector('#cloud-auth-message');
    if (messageEl && message !== undefined) messageEl.textContent = message;
    root.querySelectorAll('button, input').forEach(control => { control.disabled = !!busy; });
    const signinButton = root.querySelector('#cloud-signin');
    if (signinButton) signinButton.textContent = busy ? 'Connecting…' : 'Sign in';
    const signupButton = root.querySelector('#cloud-signup');
    if (signupButton) signupButton.textContent = busy ? 'Creating…' : 'Create account';
  }

  function showLoading(message) {
    let root = document.getElementById('cloud-auth-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cloud-auth-root';
      document.body.appendChild(root);
    }
    const logoPath = location.pathname.includes('/pages/')
      ? '../assets/brand/dashly-logo.svg'
      : 'assets/brand/dashly-logo.svg';
    root.innerHTML = [
      '<section class="cloud-auth-card cloud-loading-card" role="status" aria-live="polite">',
      '<img src="' + logoPath + '" alt="Dashly" class="cloud-auth-logo">',
      '<span class="cloud-loading-spinner" aria-hidden="true"></span>',
      '<p class="cloud-loading-message"></p>',
      '</section>'
    ].join('');
    root.querySelector('.cloud-loading-message').textContent = message;
  }

  function renderAuthForm(section, email, message, password) {
    section.innerHTML = [
      '<img src="' + (location.pathname.includes('/pages/') ? '../assets/brand/dashly-logo.svg' : 'assets/brand/dashly-logo.svg') + '" alt="Dashly" class="cloud-auth-logo">',
      '<h1 id="cloud-auth-title">Your dashboard, synced</h1>',
      '<p class="cloud-auth-description">Sign in or create an account with your email and password.</p>',
      '<form id="cloud-auth-form">',
      '<label for="cloud-email">Email</label><input id="cloud-email" name="email" type="email" autocomplete="email" required>',
      '<label for="cloud-password">Password</label><input id="cloud-password" name="password" type="password" autocomplete="current-password" minlength="8" required>',
      '<p id="cloud-auth-message" class="cloud-auth-message" role="status" aria-live="polite"></p>',
      '<button id="cloud-signin" class="btn btn-primary" type="submit">Sign in</button>',
      '<button id="cloud-signup" class="btn btn-secondary" type="button">Create account</button>',
      '</form>'
    ].join('');
    const form = section.querySelector('#cloud-auth-form');
    const emailInput = section.querySelector('#cloud-email');
    const passwordInput = section.querySelector('#cloud-password');
    if (email) emailInput.value = email;
    if (password) passwordInput.value = password;
    section.querySelector('#cloud-auth-message').textContent = message || '';
    section.querySelector('#cloud-signup').addEventListener('click', () => {
      if (form.reportValidity()) submitAuth('signup');
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      submitAuth('signin');
    });
    if (!email) emailInput.focus();
    else passwordInput.focus();
  }

  function hideAuth() {
    const root = document.getElementById('cloud-auth-root');
    if (root) root.remove();
    document.documentElement.classList.remove('cloud-locked');
  }

  function getHomeUrl() {
    const homePath = location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
    return new URL(homePath, location.href).href;
  }

  async function finishSignIn(user) {
    await connectUser(user);
    const homeUrl = getHomeUrl();
    if (location.href !== homeUrl) location.replace(homeUrl);
  }

  async function submitAuth(mode) {
    const root = document.getElementById('cloud-auth-root');
    if (!root) return;
    const section = root.querySelector('.cloud-auth-card');
    const email = section.querySelector('#cloud-email').value.trim();
    const password = section.querySelector('#cloud-password').value;
    section.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    const actionButton = section.querySelector(mode === 'signup' ? '#cloud-signup' : '#cloud-signin');
    if (actionButton) actionButton.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      const result = mode === 'signup'
        ? await client.auth.signUp({ email, password })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) {
        throw new Error('Account creation still requires email confirmation. In Supabase, turn off Authentication → Sign In / Providers → Email → Confirm email, then create the account again.');
      }
      if (result.data.session && result.data.session.user) {
        await finishSignIn(result.data.session.user);
        return;
      }
      throw new Error('No signed-in session was returned. Check the Supabase Email provider settings and try again.');
    } catch (error) {
      const message = mode === 'signin' && /email not confirmed/i.test(error.message || '')
        ? 'This account is still marked as unconfirmed in Supabase. Disable Confirm email for new accounts; an existing unconfirmed account may need to be confirmed in Supabase or recreated.'
        : error.message || (mode === 'signup' ? 'Could not create your account. Try again.' : 'Could not sign in. Check your email and password.');
      renderAuthForm(section, email, message, password);
    }
  }

  function connectUser(user) {
    if (connectionPromise) return connectionPromise;
    connectionPromise = loadUser(user).finally(() => { connectionPromise = null; });
    return connectionPromise;
  }

  function showSyncError(collection, error) {
    let banner = document.getElementById('cloud-sync-error');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'cloud-sync-error';
      banner.className = 'cloud-sync-error';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'assertive');
      document.body.appendChild(banner);
    }
    banner.dataset.collection = collection;
    banner.textContent = 'Could not sync ' + collection.replace('_', ' ') + ': ' +
      (error.message || 'check your connection and try again.');
  }

  function clearSyncError(collection) {
    const banner = document.getElementById('cloud-sync-error');
    if (banner && banner.dataset.collection === collection) banner.remove();
  }

  function parseArray(raw) {
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && item.id != null) : [];
    } catch (error) {
      console.error('Could not decode local dashboard data before cloud sync.', error);
      return [];
    }
  }

  function rowFor(collection, item) {
    return {
      user_id: currentUserId,
      collection,
      record_id: collection === 'pomodoro_state' ? 'current' : String(item.id),
      data: item,
      updated_at: new Date().toISOString()
    };
  }

  async function readCollection(collection) {
    const { data, error } = await client.from('dashboard_records')
      .select('record_id,data')
      .eq('user_id', currentUserId)
      .eq('collection', collection);
    if (error) throw error;
    return data;
  }

  async function fetchAllCollections() {
    const { data, error } = await client.from('dashboard_records')
      .select('collection,record_id,data')
      .eq('user_id', currentUserId);
    if (error) throw error;
    return data;
  }

  function setLocal(key, value) {
    if (value == null) originalRemoveItem.call(localStorage, key);
    else originalSetItem.call(localStorage, key, JSON.stringify(value));
  }

  async function hydrate(records) {
    const grouped = new Map();
    Object.keys(STORAGE_KEYS).forEach(collection => grouped.set(collection, []));
    records.forEach(row => {
      const list = grouped.get(row.collection);
      if (list) list.push(row);
    });
    Object.entries(STORAGE_KEYS).forEach(([collection, key]) => {
      const rows = grouped.get(collection) || [];
      const value = collection === 'pomodoro_state'
        ? (rows.find(row => row.record_id === 'current') || {}).data
        : rows.map(row => row.data);
      setLocal(key, value);
    });
    originalSetItem.call(localStorage, USER_MARKER, currentUserId);
  }

  async function syncCollection(collection, value, previousValue) {
    if (!currentUserId || !initialSync) return;
    let rows;
    let removed;
    if (collection === 'pomodoro_state') {
      const previous = previousValue && typeof previousValue === 'object' ? previousValue : null;
      const current = value && typeof value === 'object' ? value : null;
      const changed = stableStringify(previous) !== stableStringify(current);
      rows = changed && current ? [rowFor(collection, current)] : [];
      removed = changed && previous && !current ? ['current'] : [];
    } else {
      const previous = Array.isArray(previousValue) ? previousValue : [];
      const current = Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && item.id != null) : [];
      const previousById = new Map(previous.filter(item => item && item.id != null).map(item => [String(item.id), item]));
      const currentById = new Map(current.map(item => [String(item.id), item]));
      removed = Array.from(previousById.keys()).filter(id => !currentById.has(id));
      rows = current
        .filter(item => {
          const before = previousById.get(String(item.id));
          return !before || stableStringify(before) !== stableStringify(item);
        })
        .map(item => rowFor(collection, item));
    }
    if (removed.length) {
      const { error } = await client.from('dashboard_records')
        .delete()
        .eq('user_id', currentUserId)
        .eq('collection', collection)
        .in('record_id', removed);
      if (error) throw error;
    }
    if (rows.length) {
      const { error } = await client.from('dashboard_records')
        .upsert(rows, { onConflict: 'user_id,collection,record_id' });
      if (error) throw error;
    }
  }

  function readPendingWrites() {
    try {
      const pending = JSON.parse(originalGetItem.call(localStorage, PENDING_KEY) || '{}');
      return pending && typeof pending === 'object' && !Array.isArray(pending) ? pending : {};
    } catch (error) {
      console.error('Could not read the pending cloud-save journal.', error);
      return {};
    }
  }

  function recordPendingWrite(collection, previousRaw, valueRaw) {
    const pending = readPendingWrites();
    const existing = pending[collection];
    pending[collection] = {
      previous: existing ? existing.previous : previousRaw,
      value: valueRaw
    };
    originalSetItem.call(localStorage, PENDING_KEY, JSON.stringify(pending));
  }

  function clearPendingWrite(collection, syncedRaw) {
    const pending = readPendingWrites();
    if (!pending[collection] || pending[collection].value !== syncedRaw) return;
    delete pending[collection];
    if (Object.keys(pending).length) originalSetItem.call(localStorage, PENDING_KEY, JSON.stringify(pending));
    else originalRemoveItem.call(localStorage, PENDING_KEY);
  }

  function applyPendingWrites(records, pending) {
    Object.entries(pending).forEach(([collection, entry]) => {
      if (!STORAGE_KEYS[collection] || !entry || typeof entry.value !== 'string') return;
      let previous = null;
      let desired = null;
      try {
        previous = entry.previous ? JSON.parse(entry.previous) : null;
        desired = JSON.parse(entry.value);
      } catch (error) {
        console.error('Could not apply a pending cloud change for ' + collection + '.', error);
        return;
      }
      if (collection === 'pomodoro_state') {
        records = records.filter(row => !(row.collection === collection && row.record_id === 'current'));
        if (desired && typeof desired === 'object') records.push(rowFor(collection, desired));
        return;
      }
      const before = Array.isArray(previous) ? previous : [];
      const after = Array.isArray(desired) ? desired.filter(item => item && item.id != null) : [];
      const beforeById = new Map(before.map(item => [String(item.id), item]));
      const afterById = new Map(after.map(item => [String(item.id), item]));
      const changedIds = new Set();
      beforeById.forEach((item, id) => {
        if (!afterById.has(id) || JSON.stringify(item) !== JSON.stringify(afterById.get(id))) changedIds.add(id);
      });
      afterById.forEach((item, id) => {
        if (!beforeById.has(id)) changedIds.add(id);
      });
      records = records.filter(row => !(row.collection === collection && changedIds.has(row.record_id)));
      changedIds.forEach(id => {
        if (afterById.has(id)) records.push(rowFor(collection, afterById.get(id)));
      });
    });
    return records;
  }

  function scheduleSync(key, value, previousRaw) {
    const collection = Object.keys(STORAGE_KEYS).find(name => STORAGE_KEYS[name] === key);
    if (!collection || !currentUserId || !initialSync) return;
    if (collection === 'pomodoro_state' && previousRaw) {
      try {
        if (isTimerTick(JSON.parse(previousRaw), value)) return;
      } catch (error) {
        console.error('Could not compare Pomodoro state before cloud sync.', error);
      }
    }
    const snapshotRaw = originalGetItem.call(localStorage, key);
    recordPendingWrite(collection, previousRaw, snapshotRaw);
    if (syncTimers.has(collection)) clearTimeout(syncTimers.get(collection));
    syncTimers.set(collection, setTimeout(() => {
      syncTimers.delete(collection);
      const pending = readPendingWrites()[collection];
      const latestRaw = originalGetItem.call(localStorage, key);
      let latestValue = null;
      let baseline = null;
      try {
        latestValue = latestRaw ? JSON.parse(latestRaw) : null;
        baseline = pending && pending.previous ? JSON.parse(pending.previous) : null;
      } catch (error) {
        console.error('Could not read queued ' + collection + ' data before cloud sync.', error);
        showSyncError(collection, error);
        return;
      }
      changeQueue = changeQueue
        .then(() => syncCollection(collection, latestValue, baseline))
        .then(() => {
          clearPendingWrite(collection, latestRaw);
          clearSyncError(collection);
        })
        .catch(error => {
          console.error('Cloud save failed for ' + collection + '.', error);
          showSyncError(collection, error);
          window.dispatchEvent(new CustomEvent('dashly:cloud-error', {
            detail: { collection, message: error.message }
          }));
        });
    }, 300));
  }

  function dispatchRefresh(collection) {
    const key = STORAGE_KEYS[collection];
    if (!key) return;
    window.dispatchEvent(new CustomEvent('dashly:remote-update', { detail: { collection, key } }));
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort()
        .map(key => JSON.stringify(key) + ':' + stableStringify(value[key]))
        .join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function isTimerTick(previous, current) {
    if (!previous || !current || previous.isRunning !== true || current.isRunning !== true) return false;
    const stableFields = [
      'mode',
      'configuredFocusDuration',
      'configuredBreakDuration',
      'deadlineAt',
      'sessionStartedAt',
      'sessionElapsedMs',
      'sessionSegmentStartedAt'
    ];
    return stableFields.every(field => previous[field] === current[field]);
  }

  async function refreshRemoteCollection(collection) {
    const records = await readCollection(collection);
    const key = STORAGE_KEYS[collection];
    const value = collection === 'pomodoro_state'
      ? ((records.find(row => row.record_id === 'current') || {}).data)
      : records.map(row => row.data);
    let current;
    try {
      const raw = originalGetItem.call(localStorage, key);
      current = raw ? JSON.parse(raw) : null;
    } catch (error) {
      current = null;
    }
    const canonical = item => collection === 'pomodoro_state'
      ? stableStringify(item || null)
      : stableStringify((Array.isArray(item) ? item : []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
    if (canonical(current) === canonical(value)) return;
    setLocal(key, value);
    dispatchRefresh(collection);
  }

  function listenForRemoteChanges() {
    if (realtimeChannel) client.removeChannel(realtimeChannel);
    realtimeChannel = client.channel('dashly-records-' + currentUserId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'dashboard_records',
        filter: 'user_id=eq.' + currentUserId
      }, payload => {
        const collection = (payload.new && payload.new.collection) || (payload.old && payload.old.collection);
        if (!collection) return;
        changeQueue = changeQueue
          .then(() => refreshRemoteCollection(collection))
          .catch(error => console.error('Could not refresh synced ' + collection + '.', error));
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Live cloud sync status:', status);
          showSyncError('live updates', new Error('reconnect to Supabase to receive changes from your other devices.'));
        }
      });
  }

  async function loadUser(user) {
    currentUserId = user.id;
    const previousUser = originalGetItem.call(localStorage, USER_MARKER);
    showLoading(previousUser === user.id
      ? 'Restoring your dashboard…'
      : 'Loading your synced dashboard…');
    try {
      let records = await fetchAllCollections();
      if (previousUser !== user.id) {
        Object.values(STORAGE_KEYS).forEach(key => originalRemoveItem.call(localStorage, key));
        originalRemoveItem.call(localStorage, PENDING_KEY);
      } else {
        const pending = readPendingWrites();
        records = applyPendingWrites(records, pending);
      }
      await hydrate(records);
      initialSync = true;
      hideAuth();
      listenForRemoteChanges();
      addAccountControl(user.email);
      if (previousUser === user.id) {
        Object.entries(readPendingWrites()).forEach(([collection, entry]) => {
          const key = STORAGE_KEYS[collection];
          if (!key) return;
          let value = null;
          try {
            const raw = originalGetItem.call(localStorage, key);
            value = raw ? JSON.parse(raw) : null;
          } catch (error) {
            console.error('Could not retry a pending cloud save for ' + collection + '.', error);
            return;
          }
          scheduleSync(key, value, entry.previous);
        });
      }
      resolveReady(window.DashlyCloud);
    } catch (error) {
      currentUserId = null;
      initialSync = false;
      showAuth('Could not load your cloud data: ' + (error.message || 'unknown error') + '. No browser data was cleared.', false);
    }
  }

  function addAccountControl(email) {
    const existing = document.getElementById('cloud-account-control');
    if (existing) existing.remove();
    const control = document.createElement('div');
    control.id = 'cloud-account-control';
    control.className = 'cloud-account-control';
    control.innerHTML = '<span class="cloud-account-email"></span><button type="button" class="cloud-signout">Sign out</button>';
    control.querySelector('.cloud-account-email').textContent = email || 'Signed in';
    control.querySelector('.cloud-signout').addEventListener('click', async () => {
      const button = control.querySelector('.cloud-signout');
      button.disabled = true;
      try {
        await flushPendingWrites();
        initialSync = false;
        if (realtimeChannel) await client.removeChannel(realtimeChannel);
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch (error) {
        button.disabled = false;
        console.error('Could not sign out safely.', error);
        showSyncError('sign out', error);
      }
    });
    const sidebar = document.getElementById('sidebar');
    (sidebar || document.body).appendChild(control);
  }

  async function flushPendingWrites() {
    syncTimers.forEach(timer => clearTimeout(timer));
    syncTimers.clear();
    await changeQueue;
    const pending = readPendingWrites();
    for (const [collection, entry] of Object.entries(pending)) {
      const key = STORAGE_KEYS[collection];
      if (!key) continue;
      if (syncTimers.has(collection)) {
        clearTimeout(syncTimers.get(collection));
        syncTimers.delete(collection);
      }
      const raw = originalGetItem.call(localStorage, key);
      let value = null;
      try {
        value = raw ? JSON.parse(raw) : null;
      } catch (error) {
        throw new Error('Could not read pending ' + collection.replace('_', ' ') + ' data before signing out.');
      }
      const previousValue = entry.previous ? JSON.parse(entry.previous) : null;
      await syncCollection(collection, value, previousValue);
      clearPendingWrite(collection, raw);
    }
  }

  Storage.prototype.setItem = function(key, value) {
    const previousRaw = this === localStorage ? originalGetItem.call(this, key) : null;
    originalSetItem.call(this, key, value);
    if (this === localStorage) {
      let parsed = value;
      try { parsed = JSON.parse(value); } catch (_) { /* Only app JSON keys sync. */ }
      scheduleSync(String(key), parsed, previousRaw);
    }
  };
  Storage.prototype.removeItem = function(key) {
    const previousRaw = this === localStorage ? originalGetItem.call(this, key) : null;
    originalRemoveItem.call(this, key);
    if (this === localStorage) scheduleSync(String(key), null, previousRaw);
  };

  window.addEventListener('online', () => {
    if (!currentUserId || !initialSync) return;
    Object.entries(readPendingWrites()).forEach(([collection, entry]) => {
      const key = STORAGE_KEYS[collection];
      if (!key) return;
      let value = null;
      try {
        const raw = originalGetItem.call(localStorage, key);
        value = raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.error('Could not retry pending ' + collection + ' data after reconnecting.', error);
        return;
      }
      scheduleSync(key, value, entry.previous);
    });
  });

  window.DashlyCloud = {
    ready,
    start(init) { ready.then(init).catch(error => console.error('Dashly cloud startup failed.', error)); },
    get client() { return client; },
    get userId() { return currentUserId; },
    reportError(error) { console.error('Dashly cloud error:', error); },
    async signOut() {
      if (client) return client.auth.signOut();
      return { error: new Error('Cloud is not initialized.') };
    }
  };

  async function boot() {
    const config = window.DASHLY_SUPABASE_CONFIG;
    if (!config || !config.url || !config.publishableKey) {
      showAuth('Cloud setup is incomplete. Add the Supabase project URL and publishable key.', false);
      rejectReady(new Error('Missing Supabase project configuration.'));
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      showAuth('Could not load the Supabase client. Check your internet connection and reload.', false);
      rejectReady(new Error('Supabase JavaScript client is unavailable.'));
      return;
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) await connectUser(data.session.user);
    else showAuth('', false);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        initialSync = false;
        currentUserId = null;
        setTimeout(() => {
          Object.values(STORAGE_KEYS).forEach(key => originalRemoveItem.call(localStorage, key));
          originalRemoveItem.call(localStorage, USER_MARKER);
          originalRemoveItem.call(localStorage, PENDING_KEY);
          location.reload();
        }, 0);
      } else if (event === 'SIGNED_IN' && session && !initialSync) {
        setTimeout(() => {
          if (!initialSync) connectUser(session.user);
        }, 0);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (originalGetItem.call(localStorage, USER_MARKER)) {
      showLoading('Restoring your dashboard…');
    } else {
      showAuth('Connecting to Dashly…', true);
    }
    boot().catch(error => {
      console.error('Could not initialize Supabase.', error);
      showAuth('Could not connect to Supabase: ' + (error.message || 'check your connection and project settings.'), false);
      rejectReady(error);
    });
  }, { once: true });
})();
