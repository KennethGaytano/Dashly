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
  let currentUsername = null;
  let currentFirstName = '';
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
    if (signupButton) signupButton.textContent = busy ? 'Signing up…' : 'Sign up';
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

  function renderAuthForm(section, email, message, password, firstName, lastName, username, mode) {
    const isSignup = mode === 'signup';
    const nameFields = isSignup
      ? [
          '<div class="cloud-auth-name-fields">',
          '<div><label for="cloud-first-name">First name</label><input id="cloud-first-name" name="firstName" type="text" autocomplete="given-name" maxlength="80" required></div>',
          '<div><label for="cloud-last-name">Last name</label><input id="cloud-last-name" name="lastName" type="text" autocomplete="family-name" maxlength="80" required></div>',
          '</div>'
        ].join('')
      : '';
    section.innerHTML = [
      '<img src="' + (location.pathname.includes('/pages/') ? '../assets/brand/dashly-logo.svg' : 'assets/brand/dashly-logo.svg') + '" alt="Dashly" class="cloud-auth-logo">',
      '<h1 id="cloud-auth-title">Your dashboard, synced</h1>',
      '<p class="cloud-auth-description">' + (isSignup
        ? 'Sign up with your first name, last name, username, email, and password.'
        : 'Sign in with your email and password, or sign up for a new account.') + '</p>',
      '<form id="cloud-auth-form">',
      nameFields,
      isSignup
        ? '<label for="cloud-username">Username</label><input id="cloud-username" name="username" type="text" autocomplete="username" autocapitalize="none" maxlength="32" required>'
        : '',
      '<label for="cloud-email">Email</label><input id="cloud-email" name="email" type="email" autocomplete="email" required>',
      '<label for="cloud-password">Password</label><input id="cloud-password" name="password" type="password" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" minlength="8" required>',
      '<p id="cloud-auth-message" class="cloud-auth-message" role="status" aria-live="polite"></p>',
      isSignup
        ? '<button id="cloud-create-account" class="btn btn-primary" type="submit">Create account</button><button id="cloud-back-to-signin" class="btn btn-secondary" type="button">Back to sign in</button>'
        : '<button id="cloud-signin" class="btn btn-primary" type="submit">Sign in</button><button id="cloud-signup" class="btn btn-secondary" type="button">Sign up</button>',
      '</form>'
    ].join('');
    const form = section.querySelector('#cloud-auth-form');
    const emailInput = section.querySelector('#cloud-email');
    const passwordInput = section.querySelector('#cloud-password');
    const firstNameInput = section.querySelector('#cloud-first-name');
    const lastNameInput = section.querySelector('#cloud-last-name');
    const usernameInput = section.querySelector('#cloud-username');
    if (email) emailInput.value = email;
    if (password) passwordInput.value = password;
    if (firstNameInput && firstName) firstNameInput.value = firstName;
    if (lastNameInput && lastName) lastNameInput.value = lastName;
    if (usernameInput && username) usernameInput.value = username;
    section.querySelector('#cloud-auth-message').textContent = message || '';
    const signupButton = section.querySelector('#cloud-signup');
    if (signupButton) {
      signupButton.addEventListener('click', () => {
        renderAuthForm(
          section,
          emailInput.value,
          '',
          passwordInput.value,
          firstNameInput ? firstNameInput.value : firstName,
          lastNameInput ? lastNameInput.value : lastName,
          usernameInput ? usernameInput.value : username,
          'signup'
        );
      });
    }
    const backButton = section.querySelector('#cloud-back-to-signin');
    if (backButton) {
      backButton.addEventListener('click', () => {
        renderAuthForm(
          section,
          emailInput.value,
          '',
          passwordInput.value,
          firstNameInput.value,
          lastNameInput.value,
          usernameInput.value
        );
      });
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      submitAuth(isSignup ? 'signup' : 'signin');
    });
    if (!email) {
      if (isSignup && firstNameInput) firstNameInput.focus();
      else emailInput.focus();
    } else if (isSignup && firstNameInput) firstNameInput.focus();
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
    const params = new URLSearchParams(location.search);
    const destination = location.pathname.endsWith('/pages/notes.html') && params.get('new') === '1'
      ? location.href
      : getHomeUrl();
    await connectUser(user);
    if (location.href !== destination) location.replace(destination);
  }

  async function submitAuth(mode) {
    const root = document.getElementById('cloud-auth-root');
    if (!root) return;
    const section = root.querySelector('.cloud-auth-card');
    const email = section.querySelector('#cloud-email').value.trim();
    const password = section.querySelector('#cloud-password').value;
    const firstNameInput = section.querySelector('#cloud-first-name');
    const lastNameInput = section.querySelector('#cloud-last-name');
    const usernameInput = section.querySelector('#cloud-username');
    const firstName = firstNameInput ? firstNameInput.value.trim() : '';
    const lastName = lastNameInput ? lastNameInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim() : '';
    if (mode === 'signup' && (!firstName || !lastName || !username)) {
      const missingField = !firstName ? firstNameInput : !lastName ? lastNameInput : usernameInput;
      const message = section.querySelector('#cloud-auth-message');
      if (message) message.textContent = 'Enter your first name, last name, and username to create an account.';
      if (missingField) missingField.focus();
      return;
    }
    section.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    const actionButton = section.querySelector(mode === 'signup' ? '#cloud-create-account' : '#cloud-signin');
    if (actionButton) actionButton.textContent = mode === 'signup' ? 'Signing up…' : 'Signing in…';
    try {
      const result = mode === 'signup'
        ? await client.auth.signUp({
            email,
            password,
            options: {
              data: {
                first_name: firstName,
                last_name: lastName,
                full_name: [firstName, lastName].filter(Boolean).join(' '),
                username
              }
            }
          })
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
      renderAuthForm(section, email, message, password, firstName, lastName, username, mode);
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
      username: currentUsername || null,
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

  async function backfillUsername(previousUsername) {
    if (!currentUsername) return;
    let query = client.from('dashboard_records')
      .update({ username: currentUsername })
      .eq('user_id', currentUserId)
      .is('username', null);
    if (previousUsername) {
      const { error: renameError } = await client.from('dashboard_records')
        .update({ username: currentUsername })
        .eq('user_id', currentUserId)
        .eq('username', previousUsername);
      if (renameError) {
        console.warn('Could not update the username on cloud records after a rename.', renameError);
      }
    }
    const { error } = await query;
    if (error) {
      console.warn('Could not fill in the username on existing cloud records.', error);
    }
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
    const metadata = user.user_metadata || {};
    currentUsername = typeof metadata.username === 'string' && metadata.username
      ? metadata.username
      : null;
    currentFirstName = typeof metadata.first_name === 'string' ? metadata.first_name : '';
    const previousUser = originalGetItem.call(localStorage, USER_MARKER);
    if (previousUser !== user.id) showLoading('Loading your synced dashboard…');
    try {
      let records = await fetchAllCollections();
      await backfillUsername();
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
      addAccountControl(user);
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

  function showAccountSettings(user) {
    const dialog = document.createElement('dialog');
    dialog.className = 'cloud-settings-dialog';
    dialog.setAttribute('aria-labelledby', 'cloud-settings-title');
    dialog.innerHTML = [
      '<header class="cloud-settings-header">',
      '<div><h2 id="cloud-settings-title">Account settings</h2><p>Update the profile details saved to your Dashly account.</p></div>',
      '<button type="button" class="cloud-settings-close" aria-label="Close account settings">×</button>',
      '</header>',
      '<form class="cloud-profile-form">',
      '<div class="cloud-profile-fields">',
      '<div><label for="cloud-settings-first-name">First name</label><input id="cloud-settings-first-name" name="first_name" type="text" autocomplete="given-name" maxlength="80" required></div>',
      '<div><label for="cloud-settings-last-name">Last name</label><input id="cloud-settings-last-name" name="last_name" type="text" autocomplete="family-name" maxlength="80" required></div>',
      '</div>',
      '<div class="cloud-settings-username"><label for="cloud-settings-username">Username</label><input id="cloud-settings-username" name="username" type="text" autocomplete="username" autocapitalize="none" maxlength="32" required></div>',
      '<p class="cloud-settings-status" role="status" aria-live="polite"></p>',
      '<button type="submit" class="btn btn-primary cloud-settings-save">Save name</button>',
      '</form>',
      '<section class="cloud-settings-account" aria-labelledby="cloud-settings-switch-title">',
      '<h3 id="cloud-settings-switch-title">Use another account</h3>',
      '<p>Sign out to sign in with another account or create a new one. Your synced data stays with its account.</p>',
      '<button type="button" class="btn btn-secondary cloud-settings-switch">Sign out to add or switch account</button>',
      '</section>',
      '<section class="cloud-settings-delete" aria-labelledby="cloud-settings-delete-title">',
      '<h3 id="cloud-settings-delete-title">Delete this account</h3>',
      '<p>This permanently deletes your Dashly account and all synced dashboard data. This cannot be undone.</p>',
      '<label for="cloud-settings-delete-confirm">Type DELETE to confirm</label>',
      '<input id="cloud-settings-delete-confirm" type="text" autocomplete="off" spellcheck="false">',
      '<p class="cloud-settings-delete-status" role="status" aria-live="polite"></p>',
      '<button type="button" class="btn btn-danger cloud-settings-delete-button">Delete account and data</button>',
      '</section>'
    ].join('');

    const metadata = user.user_metadata || {};
    const firstName = dialog.querySelector('#cloud-settings-first-name');
    const lastName = dialog.querySelector('#cloud-settings-last-name');
    const username = dialog.querySelector('#cloud-settings-username');
    const profileForm = dialog.querySelector('.cloud-profile-form');
    const profileStatus = dialog.querySelector('.cloud-settings-status');
    const saveButton = dialog.querySelector('.cloud-settings-save');
    const deleteConfirmation = dialog.querySelector('#cloud-settings-delete-confirm');
    const deleteStatus = dialog.querySelector('.cloud-settings-delete-status');
    const deleteButton = dialog.querySelector('.cloud-settings-delete-button');

    firstName.value = typeof metadata.first_name === 'string' ? metadata.first_name : '';
    lastName.value = typeof metadata.last_name === 'string' ? metadata.last_name : '';
    username.value = typeof metadata.username === 'string' ? metadata.username : '';

    dialog.querySelector('.cloud-settings-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    profileForm.addEventListener('submit', async event => {
      event.preventDefault();
      saveButton.disabled = true;
      profileStatus.setAttribute('role', 'status');
      profileStatus.textContent = 'Saving…';
      const nextFirstName = firstName.value.trim();
      const nextLastName = lastName.value.trim();
      const nextUsername = username.value.trim();
      if (!nextFirstName || !nextLastName || !nextUsername) {
        profileStatus.setAttribute('role', 'alert');
        profileStatus.textContent = 'Enter your first name, last name, and username.';
        saveButton.disabled = false;
        return;
      }
      try {
        const previousUsername = currentUsername;
        const { data, error } = await client.auth.updateUser({
          data: {
            ...(user.user_metadata || {}),
            first_name: nextFirstName,
            last_name: nextLastName,
            full_name: [nextFirstName, nextLastName].join(' '),
            username: nextUsername
          }
        });
        if (error) throw error;
        if (!data.user) throw new Error('Supabase did not return the updated account profile.');
        user = data.user;
        currentUsername = nextUsername;
        currentFirstName = nextFirstName;
        if (previousUsername !== nextUsername) await backfillUsername(previousUsername);
        profileStatus.textContent = 'Name saved.';
      } catch (error) {
        console.error('Could not update the account profile.', error);
        profileStatus.setAttribute('role', 'alert');
        profileStatus.textContent = error.message || 'Could not save your name. Try again.';
      } finally {
        saveButton.disabled = false;
      }
    });
    dialog.querySelector('.cloud-settings-switch').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Signing out…';
      try {
        await flushPendingWrites();
        initialSync = false;
        if (realtimeChannel) await client.removeChannel(realtimeChannel);
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Sign out to add or switch account';
        console.error('Could not safely switch accounts.', error);
        profileStatus.setAttribute('role', 'alert');
        profileStatus.textContent = error.message || 'Could not sign out. Try again.';
      }
    });
    deleteButton.addEventListener('click', async () => {
      if (deleteConfirmation.value !== 'DELETE') {
        deleteStatus.setAttribute('role', 'alert');
        deleteStatus.textContent = 'Type DELETE exactly to confirm account deletion.';
        deleteConfirmation.focus();
        return;
      }
      deleteButton.disabled = true;
      deleteConfirmation.disabled = true;
      deleteStatus.setAttribute('role', 'status');
      deleteStatus.textContent = 'Deleting your account and synced data…';
      try {
        const { error } = await client.functions.invoke('delete-account', { body: {} });
        if (error) throw error;
        const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
      } catch (error) {
        deleteButton.disabled = false;
        deleteConfirmation.disabled = false;
        console.error('Could not delete the Dashly account.', error);
        deleteStatus.setAttribute('role', 'alert');
        deleteStatus.textContent = error.message || 'Could not delete the account. Try again.';
      }
    });

    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    firstName.focus();
  }

  function addAccountControl(user) {
    const existing = document.getElementById('cloud-account-control');
    if (existing) existing.remove();
    const control = document.createElement('div');
    control.id = 'cloud-account-control';
    control.className = 'cloud-account-control';
    control.innerHTML = [
      '<span class="cloud-account-email"></span>',
      '<div class="cloud-account-actions">',
      '<button type="button" class="cloud-settings-open">Settings</button>',
      '<button type="button" class="cloud-signout">Sign out</button>',
      '</div>'
    ].join('');
    control.querySelector('.cloud-account-email').textContent = user.email || 'Signed in';
    control.querySelector('.cloud-settings-open').addEventListener('click', () => showAccountSettings(user));
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
    get username() { return currentUsername; },
    get firstName() { return currentFirstName; },
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
        currentUsername = null;
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
    if (!originalGetItem.call(localStorage, USER_MARKER)) {
      showAuth('Connecting to Dashly…', true);
    }
    boot().catch(error => {
      console.error('Could not initialize Supabase.', error);
      showAuth('Could not connect to Supabase: ' + (error.message || 'check your connection and project settings.'), false);
      rejectReady(error);
    });
  }, { once: true });
})();
