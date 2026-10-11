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
  // Cached identity so the account row can be painted synchronously on the next
  // page load. Without it the sidebar renders with a gap where the row belongs
  // and the row pops in once the record fetch resolves.
  const IDENTITY_KEY = 'dashly_cloud_identity';
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

  function renderAuthForm(section, identifier, message, password, firstName, lastName, username, mode) {
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
        : 'Sign in with your username and password, or sign up for a new account.') + '</p>',
      '<form id="cloud-auth-form">',
      nameFields,
      isSignup
        ? '<label for="cloud-username">Username</label><input id="cloud-username" name="username" type="text" autocomplete="username" autocapitalize="none" maxlength="32" required>'
        : '',
      isSignup
        ? '<label for="cloud-email">Email</label><input id="cloud-email" name="email" type="email" autocomplete="email" required>'
        : '<label for="cloud-login-username">Username or email</label><input id="cloud-login-username" name="username" type="text" autocomplete="username" autocapitalize="none" maxlength="320" required>' +
          '<p class="cloud-auth-hint">New here? Use the username you picked at sign-up. Older accounts: sign in with your email, then add a username in Account settings.</p>',
      '<label for="cloud-password">Password</label><input id="cloud-password" name="password" type="password" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" minlength="8" required>',
      '<p id="cloud-auth-message" class="cloud-auth-message" role="status" aria-live="polite"></p>',
      isSignup
        ? '<button id="cloud-create-account" class="btn btn-primary" type="submit">Create account</button><button id="cloud-back-to-signin" class="btn btn-secondary" type="button">Back to sign in</button>'
        : '<button id="cloud-signin" class="btn btn-primary" type="submit">Sign in</button><button id="cloud-signup" class="btn btn-secondary" type="button">Sign up</button>',
      '</form>'
    ].join('');
    const form = section.querySelector('#cloud-auth-form');
    const identifierInput = section.querySelector(isSignup ? '#cloud-email' : '#cloud-login-username');
    const emailInput = section.querySelector('#cloud-email');
    const passwordInput = section.querySelector('#cloud-password');
    const firstNameInput = section.querySelector('#cloud-first-name');
    const lastNameInput = section.querySelector('#cloud-last-name');
    const usernameInput = section.querySelector('#cloud-username');
    if (identifier) identifierInput.value = identifier;
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
          identifierInput.value,
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
          identifierInput.value,
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
    if (!identifier) {
      if (isSignup && firstNameInput) firstNameInput.focus();
      else identifierInput.focus();
    } else if (isSignup && firstNameInput) firstNameInput.focus();
    else passwordInput.focus();
  }

  function hideAuth() {
    const root = document.getElementById('cloud-auth-root');
    if (root) root.remove();
    document.documentElement.classList.remove('cloud-locked');
  }

  function accountIconPath(theme) {
    const basePath = location.pathname.includes('/pages/') ? '../assets/icons/' : 'assets/icons/';
    return basePath + (theme === 'light' ? 'account-icon.svg' : 'account-icon-dark.svg');
  }

  function updateAccountIcons() {
    const source = accountIconPath(document.documentElement.dataset.theme);
    document.querySelectorAll('.cloud-account-icon').forEach(icon => {
      icon.src = source;
    });
  }

  document.addEventListener('dashly:theme-change', updateAccountIcons);

  function getHomeUrl() {
    // cleanUrls: the site root is "/" at every depth, so the depth check the
    // relative path used to need is gone.
    return new URL('/', location.origin).href;
  }

  async function finishSignIn(user) {
    const params = new URLSearchParams(location.search);
    const destination = location.pathname.endsWith('/pages/notes') && params.get('new') === '1'
      ? location.href
      : getHomeUrl();
    await connectUser(user);
    if (location.href !== destination) location.replace(destination);
  }

  /**
   * supabase-js replaces the Edge Function's own error body with a generic
   * "Edge Function returned a non-2xx status code" message. The useful text is
   * still on the raw Response, so read it back out of error.context and
   * re-throw it as the message the form actually shows.
   */
  async function edgeFunctionMessage(error) {
    const fallback = 'Could not sign in. Check your username and password.';
    if (!error) return fallback;
    const context = error.context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        if (payload && typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
        if (payload && typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
      } catch (_) {
        // Body was not JSON or was already consumed; fall through to the generic text.
      }
    }
    return error.message || fallback;
  }

  async function submitAuth(mode) {
    const root = document.getElementById('cloud-auth-root');
    if (!root) return;
    const section = root.querySelector('.cloud-auth-card');
    const identifier = section.querySelector(mode === 'signup' ? '#cloud-email' : '#cloud-login-username').value.trim();
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
            email: identifier,
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
        : await (async () => {
            const { data, error } = await client.functions.invoke('sign-in-with-username', {
              body: { username: identifier, password }
            });
            if (error) {
              const friendly = new Error(await edgeFunctionMessage(error));
              friendly.cause = error;
              throw friendly;
            }
            if (!data || !data.session) {
              throw new Error('Sign-in did not return a session. Check your username and password, then try again.');
            }
            return client.auth.setSession(data.session);
          })();
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
        : mode === 'signin'
          ? error.message || 'Could not sign in. Check your username and password.'
          : error.message || 'Could not create your account. Try again.';
      renderAuthForm(section, identifier, message, password, firstName, lastName, username, mode);
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
      cacheIdentity(user);
      paintAccountControl({ id: user.id, username: currentUsername });
      if (document.getElementById('cloud-account-settings')) showAccountSettings(user);
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
    const settings = document.getElementById('cloud-account-settings');
    if (!settings) return;
    settings.className = 'cloud-settings-page';
    settings.setAttribute('aria-labelledby', 'cloud-settings-title');
    // settings.innerHTML = [
    //   The page already has an <h1>Account settings</h1> in its own header, so
    //   repeating that title here produced two identical headings on screen. The
    //   id stays on the visually hidden heading because the section is labelled
    //   by it for screen readers; what is visible is the signed-in identity.
    settings.innerHTML = [
      '<header class="cloud-settings-header">',
      '<div class="cloud-settings-title-row">',
      '<img class="cloud-account-icon" src="' + accountIconPath(document.documentElement.dataset.theme) + '" alt="" aria-hidden="true">',
      '<div><h2 id="cloud-settings-title" class="cloud-settings-heading">Account settings</h2><p class="cloud-settings-email"></p><p>Update the profile details saved to your Dashly account.</p></div>',
      '</div>',
      '</header>',
      '<form class="cloud-profile-form">',
      '<div class="cloud-profile-fields">',
      '<div><label for="cloud-settings-first-name">First name</label><input id="cloud-settings-first-name" name="first_name" type="text" autocomplete="given-name" maxlength="80" required></div>',
      '<div><label for="cloud-settings-last-name">Last name</label><input id="cloud-settings-last-name" name="last_name" type="text" autocomplete="family-name" maxlength="80" required></div>',
      '</div>',
      '<div class="cloud-settings-username"><label for="cloud-settings-username">Username</label><input id="cloud-settings-username" name="username" type="text" autocomplete="username" autocapitalize="none" maxlength="32" required></div>',
      '<p class="cloud-settings-status" role="status" aria-live="polite"></p>',
      '<button type="submit" class="btn btn-primary cloud-settings-save">Save profile</button>',
      '</form>',
      '<section class="cloud-password-section" aria-labelledby="cloud-password-title">',
      '<h3 id="cloud-password-title">Change password</h3>',
      '<p>Confirm your current password, then choose a new one.</p>',
      '<form class="cloud-password-form">',
      '<label for="cloud-current-password">Current password</label>',
      '<input id="cloud-current-password" name="currentPassword" type="password" autocomplete="current-password" required>',
      '<label for="cloud-new-password">New password</label>',
      '<input id="cloud-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>',
      '<label for="cloud-confirm-password">Confirm new password</label>',
      '<input id="cloud-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>',
      '<p class="cloud-password-status" role="status" aria-live="polite"></p>',
      '<button type="submit" class="btn btn-primary cloud-password-save">Change password</button>',
      '</form>',
      '</section>',
      '<section class="cloud-settings-account" aria-labelledby="cloud-settings-switch-title">',
      '<h3 id="cloud-settings-switch-title">Use another account</h3>',
      '<p>Sign out to sign in with another account or create a new one. Your synced data stays with its account.</p>',
      '<button type="button" class="btn btn-secondary cloud-settings-switch">Sign out</button>',
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
    const firstName = settings.querySelector('#cloud-settings-first-name');
    const lastName = settings.querySelector('#cloud-settings-last-name');
    const username = settings.querySelector('#cloud-settings-username');
    const profileForm = settings.querySelector('.cloud-profile-form');
    const profileStatus = settings.querySelector('.cloud-settings-status');
    const saveButton = settings.querySelector('.cloud-settings-save');
    const passwordForm = settings.querySelector('.cloud-password-form');
    const passwordStatus = settings.querySelector('.cloud-password-status');
    const passwordSaveButton = settings.querySelector('.cloud-password-save');
    const deleteConfirmation = settings.querySelector('#cloud-settings-delete-confirm');
    const deleteStatus = settings.querySelector('.cloud-settings-delete-status');
    const deleteButton = settings.querySelector('.cloud-settings-delete-button');

    firstName.value = typeof metadata.first_name === 'string' ? metadata.first_name : '';
    lastName.value = typeof metadata.last_name === 'string' ? metadata.last_name : '';
    username.value = typeof metadata.username === 'string' ? metadata.username : '';

    // The email is the one identifier the user cannot edit here, so it is shown
    // in the header as plain text. textContent, not innerHTML: it is account
    // data and must never be parsed as markup.
    settings.querySelector('.cloud-settings-email').textContent = user.email || 'Signed in';

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
        const accountUsername = document.querySelector('#cloud-account-control .cloud-account-username');
        if (accountUsername) accountUsername.textContent = nextUsername;
        // Keep the cache in step, or the next page load paints the old name
        // until the session resolves.
        cacheIdentity({ id: user.id, user_metadata: { username: nextUsername } });
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
    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const currentPassword = settings.querySelector('#cloud-current-password').value;
      const newPassword = settings.querySelector('#cloud-new-password').value;
      const confirmPassword = settings.querySelector('#cloud-confirm-password').value;
      if (newPassword.length < 8) {
        passwordStatus.setAttribute('role', 'alert');
        passwordStatus.textContent = 'Your new password must be at least 8 characters.';
        return;
      }
      if (newPassword !== confirmPassword) {
        passwordStatus.setAttribute('role', 'alert');
        passwordStatus.textContent = 'The new passwords do not match.';
        return;
      }

      passwordSaveButton.disabled = true;
      passwordStatus.setAttribute('role', 'status');
      passwordStatus.textContent = 'Verifying your current password…';
      try {
        const loginName = typeof user.user_metadata?.username === 'string' && user.user_metadata.username
          ? user.user_metadata.username
          : user.email;
        if (!loginName) throw new Error('This account has no username or email to verify your current password.');
        const { data, error } = await client.functions.invoke('sign-in-with-username', {
          body: { username: loginName, password: currentPassword }
        });
        if (error) throw error;
        if (!data?.session?.user || data.session.user.id !== user.id) {
          throw new Error('The current password could not be verified for this account.');
        }
        const { error: sessionError } = await client.auth.setSession(data.session);
        if (sessionError) throw sessionError;
        const { error: updateError } = await client.auth.updateUser({ password: newPassword });
        if (updateError) throw updateError;
        passwordStatus.textContent = 'Password changed.';
        passwordForm.reset();
      } catch (error) {
        console.error('Could not change the account password.', error);
        passwordStatus.setAttribute('role', 'alert');
        passwordStatus.textContent = error.message || 'Could not change your password. Check your current password and try again.';
      } finally {
        passwordSaveButton.disabled = false;
      }
    });
    settings.querySelector('.cloud-settings-switch').addEventListener('click', async event => {
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
        button.textContent = 'Sign out';
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

    firstName.focus();
  }

  /* Render the account row from cached identity. Called twice: once synchronously
     from the cache during boot, and again with the live user once the record
     fetch resolves. Both passes go through here, and the second simply replaces
     the first, so there is never a frame without the row. */
  /* The account row must not blink out on every page switch. addAccountControl()
     used to run only after the Supabase record fetch resolved, so the sidebar
     rendered with an empty slot for a second or two on every navigation. This
     caches just enough identity to paint the row synchronously at boot; the
     live pass replaces it a moment later. */
  function readCachedIdentity() {
    try {
      const raw = originalGetItem.call(localStorage, IDENTITY_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        id: typeof parsed.id === 'string' ? parsed.id : null,
        username: typeof parsed.username === 'string' ? parsed.username : null
      };
    } catch (error) {
      console.error('Could not read the cached account identity.', error);
      return null;
    }
  }

  function cacheIdentity(user) {
    const metadata = (user && user.user_metadata) || {};
    try {
      originalSetItem.call(localStorage, IDENTITY_KEY, JSON.stringify({
        id: user && user.id ? user.id : null,
        username: typeof metadata.username === 'string' ? metadata.username : null
      }));
    } catch (error) {
      console.error('Could not cache the account identity.', error);
    }
  }

  function paintAccountControl(identity) {
    const existing = document.getElementById('cloud-account-control');
    if (existing) existing.remove();
    const control = document.createElement('div');
    control.id = 'cloud-account-control';
    control.className = 'cloud-account-control';
    // Purely informational: the avatar and username identify the signed-in
    // account and are not a target. Settings is reached from the sidebar nav,
    // so there is deliberately no link here — and no tabindex either, because a
    // non-interactive element should stay out of the tab order.
    control.innerHTML = [
      '<span class="cloud-account-summary">',
      '<img class="cloud-account-icon" src="' + accountIconPath(document.documentElement.dataset.theme) + '" alt="" aria-hidden="true">',
      '<span class="cloud-account-username"></span>',
      '</span>',
      '<div class="cloud-account-actions">',
      '<button type="button" class="cloud-signout">Sign out</button>',
      '</div>'
    ].join('');
    const username = identity && identity.username;
    // No aria-label here: the username text is the accessible content, and
    // overriding it with a label would hide the name from screen readers.
    control.querySelector('.cloud-account-username').textContent = username || 'Account';
    if (!identity || identity.id !== currentUserId || !currentUserId) {
      // Rendered from cache before the session is confirmed. The sign-out
      // button is wired up regardless, but it stays disabled until the live
      // session lands so an early click cannot sign out a client that is not
      // connected yet.
      control.querySelector('.cloud-signout').disabled = true;
    }
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
    // Paint the account row from cache before awaiting the session. This is the
    // fix for the sidebar row vanishing on every page switch: the row is up in
    // the first frame, then replaced in place when the live user arrives.
    if (originalGetItem.call(localStorage, USER_MARKER)) {
      const cached = readCachedIdentity();
      // Paint even with no usable cache. USER_MARKER says a session existed on
      // this device, so an empty slot in the sidebar is the worse outcome: the
      // row would not appear until the record fetch resolved. If the session
      // has actually expired, showAuth covers the sidebar with its own overlay,
      // so a brief placeholder row never becomes visible.
      paintAccountControl(cached && cached.id ? cached : { id: null, username: null });
    }

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
          // Drop the cached identity too, or the next load would paint an
          // account row for a session that no longer exists.
          originalRemoveItem.call(localStorage, IDENTITY_KEY);
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
