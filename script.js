const $ = (id) => document.getElementById(id);
const VIEW_KEY = 'my-planner-view';

/* ---------- Supabase config ---------- */
const SUPABASE_URL = 'https://vnfwgpcajhtslmaewdxd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuZndncGNhamh0c2xtYWV3ZHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwODQ2NTksImV4cCI6MjExMDY2MDY1OX0.8xzB2_0_8GdeSNOypxdC0XI7EkpmkOf7zzg5-DKaaLQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Optional Google OAuth - set to true to enable */
const ENABLE_GOOGLE = false;

/* ---------- State ---------- */
let state = { subjects: [], tasks: [], view: 'all', user: null };
let day = null; // selected day filter (YYYY-MM-DD) or null
const saveView = () => { try { localStorage.setItem(VIEW_KEY, state.view); } catch (e) {} };
const uid = () => crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

const iso = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const fromIso = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const short = (s) => fromIso(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const todayStr = iso(new Date());

// Month state: first day of the month being displayed
let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const subjectName = (id) => (state.subjects.find((s) => s.id === id) || {}).name || '';
const pending = (filter) => state.tasks.filter((t) => !t.done && filter(t)).length;

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideError(el) { el.classList.add('hidden'); }

/* ---------- Modal Helpers ---------- */
let modalResolve = null;
let modalReject = null;
let lastFocused = null;

function openModal({ title, message, showInput = false, label = '', placeholder = '', confirmText = 'OK', cancelText = 'Cancel', danger = false, inputValue = '' }) {
  return new Promise((resolve, reject) => {
    modalResolve = resolve;
    modalReject = reject;
    lastFocused = document.activeElement;

    $('modal-title').textContent = title;
    $('modal-message').textContent = message || '';
    $('modal-message').classList.toggle('hidden', !message);

    const fieldWrapper = $('modal-field-wrapper');
    const input = $('modal-input');
    const labelEl = $('modal-label');
    const errorEl = $('modal-error');
    const btns = $('modal-btns');

    if (showInput) {
      fieldWrapper.classList.remove('hidden');
      labelEl.textContent = label;
      input.placeholder = placeholder;
      input.value = inputValue;
    } else {
      fieldWrapper.classList.add('hidden');
    }
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    // Build buttons
    btns.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = cancelText;
    cancelBtn.onclick = () => closeModal(null);
    btns.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn send' + (danger ? ' danger' : '');
    confirmBtn.textContent = confirmText;
    confirmBtn.onclick = () => {
      if (showInput) {
        const val = input.value.trim();
        if (!val) {
          showError(errorEl, 'This field is required');
          input.focus();
          return;
        }
        closeModal(val);
      } else {
        closeModal(true);
      }
    };
    btns.appendChild(confirmBtn);

    // Show modal
    $('modal-overlay').classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Focus management
    setTimeout(() => {
      if (showInput) {
        input.focus();
        input.select();
      } else {
        confirmBtn.focus();
      }
    }, 0);

    // Trap focus
    document.addEventListener('keydown', trapFocus);
    document.addEventListener('keydown', handleModalKeys);
    $('modal-overlay').addEventListener('click', handleOverlayClick);
    $('modal-close').addEventListener('click', () => closeModal(null));
  });
}

function closeModal(value) {
  document.removeEventListener('keydown', trapFocus);
  document.removeEventListener('keydown', handleModalKeys);
  $('modal-overlay').removeEventListener('click', handleOverlayClick);
  $('modal-close').removeEventListener('click', () => closeModal(null));

  $('modal-overlay').classList.add('hidden');
  document.body.classList.remove('modal-open');

  if (lastFocused && lastFocused.focus) lastFocused.focus();

  if (value === null) {
    modalReject?.(null);
  } else {
    modalResolve?.(value);
  }
  modalResolve = modalReject = null;
  lastFocused = null;
}

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const modal = $('modal-window');
  const focusable = modal.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function handleModalKeys(e) {
  if (e.key === 'Escape') { closeModal(null); }
  else if (e.key === 'Enter') {
    const btn = document.querySelector('.modal-btns .btn.send:not(:disabled)');
    if (btn) btn.click();
  }
}

function handleOverlayClick(e) {
  if (e.target === $('modal-overlay')) closeModal(null);
}

// Public API
async function askText({ title, label, placeholder, confirmText = 'Add', value = '' }) {
  return openModal({ title, label, placeholder, confirmText, showInput: true, inputValue: value });
}

async function askConfirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return openModal({ title, message, confirmText, cancelText, danger });
}

async function showMessage({ title, message }) {
  return openModal({ title, message, confirmText: 'OK', cancelText: '' });
}

/* ---------- Auth UI ---------- */
function showLogin() {
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
}

function showApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = '';
  render();
}

/* Auth view switching */
function showAuthForm(formId) {
  ['login-form', 'signup-form', 'forgot-form', 'reset-form'].forEach(id => {
    $(id).classList.toggle('hidden', id !== formId);
  });
  const titles = {
    'login-form': 'Log In',
    'signup-form': 'Sign Up',
    'forgot-form': 'Forgot Password',
    'reset-form': 'New Password'
  };
  const errorIds = {
    'login-form': 'login-error',
    'signup-form': 'signup-error',
    'forgot-form': 'forgot-error',
    'reset-form': 'reset-error'
  };
  $('auth-title').textContent = titles[formId];
  $('auth-back').classList.toggle('hidden', formId === 'login-form' && formId === 'signup-form');
  hideError($(errorIds[formId]));
}

/* Storage adapter for remember me */
function getStorage(remember) {
  return remember ? localStorage : sessionStorage;
}

async function tryAutoLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.user = session.user;
    await loadData();
    showApp();
  } else {
    showLogin();
  }
}

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    state.user = session.user;
    await loadData();
    showApp();
  } else if (event === 'SIGNED_OUT') {
    state.user = null;
    state.subjects = [];
    state.tasks = [];
    state.view = 'all';
    showLogin();
  } else if (event === 'PASSWORD_RECOVERY') {
    // User clicked reset link - show new password form
    showAuthForm('reset-form');
  }
});

/* ---------- Data loading ---------- */
async function loadData() {
  try {
    // Load subjects
    const { data: subjects, error: sErr } = await sb
      .from('subjects')
      .select('*')
      .order('created_at');
    if (sErr) throw sErr;
    state.subjects = subjects || [];

    // Load tasks
    const { data: tasks, error: tErr } = await sb
      .from('tasks')
      .select('*')
      .order('created_at');
    if (tErr) throw tErr;
    state.tasks = (tasks || []).map(t => ({
      id: t.id,
      subject: t.subject_id,
      text: t.text,
      due: t.due || '',
      done: t.done,
      pri: t.pri
    }));

    // Restore view from localStorage
    try { state.view = localStorage.getItem(VIEW_KEY) || 'all'; } catch (e) {}
    if (state.view !== 'all' && !state.subjects.some(s => s.id === state.view)) state.view = 'all';

    // One-time import from old localStorage
    await maybeImportLegacy();

  } catch (e) {
    console.error('Load failed:', e);
    await showMessage({ title: 'Error', message: 'Failed to load data: ' + e.message });
  }
}

async function maybeImportLegacy() {
  const legacyKey = 'my-planner-v2';
  let legacy = null;
  try {
    const s = localStorage.getItem(legacyKey);
    if (s) legacy = JSON.parse(s);
  } catch (e) {}

  if (!legacy || !legacy.subjects?.length) return;
  if (state.subjects.length > 0) return; // already has data

  const shouldImport = await askConfirm({
    title: 'Import Data',
    message: 'Import tasks from this browser?',
    confirmText: 'Import',
    cancelText: 'Don\'t Import'
  });
  if (!shouldImport) {
    localStorage.removeItem(legacyKey);
    return;
  }

  // Map old subject ids to new uuids
  const idMap = {};
  for (const oldSub of legacy.subjects) {
    const newId = uid();
    idMap[oldSub.id] = newId;
    const { error } = await sb.from('subjects').insert({ id: newId, name: oldSub.name });
    if (error) { console.error('Import subject failed:', error); continue; }
    state.subjects.push({ id: newId, name: oldSub.name });
  }

  for (const oldTask of legacy.tasks) {
    const newSubjectId = idMap[oldTask.subject];
    if (!newSubjectId) continue;
    const { error } = await sb.from('tasks').insert({
      id: uid(),
      subject_id: newSubjectId,
      text: oldTask.text,
      due: oldTask.due || null,
      done: oldTask.done,
      pri: oldTask.pri
    });
    if (error) { console.error('Import task failed:', error); continue; }
    state.tasks.push({
      id: uid(),
      subject: newSubjectId,
      text: oldTask.text,
      due: oldTask.due || '',
      done: oldTask.done,
      pri: oldTask.pri
    });
  }

  localStorage.removeItem(legacyKey);
  render();
}

/* ---------- Sidebar ---------- */
function renderSidebar() {
  if (state.view !== 'all' && !state.subjects.some((s) => s.id === state.view)) state.view = 'all';
  $('nav-all').classList.toggle('active', state.view === 'all');
  $('badge-all').textContent = pending(() => true) || '';
  const ul = $('subjects');
  ul.innerHTML = '';
  state.subjects.forEach((s) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = state.view === s.id ? 'active' : '';
    const n = pending((t) => t.subject === s.id);
    b.innerHTML = `<span class="name"># ${esc(s.name)}</span>${n ? `<em class="badge">${n}</em>` : ''}`;
    b.onclick = () => { state.view = s.id; saveView(); render(); };
    // Double-click to rename
    b.ondblclick = (e) => { e.stopPropagation(); renameSubject(s.id); };
    li.appendChild(b);
    ul.appendChild(li);
  });
  $('no-subjects').classList.toggle('hidden', state.subjects.length > 0);

  // User info in titlebar (upper right) - desktop/tablet
  const ui = $('user-info');
  // User email line under titlebar - phone
  const emailLine = $('user-email-line');
  if (state.user?.email) {
    ui.innerHTML = `<button class="btn" id="logout-btn" style="padding: 3px 8px; font-size: .75rem;">Log out</button>`;
    emailLine.hidden = !phoneMQ.matches;
    emailLine.textContent = state.user.email;
    $('logout-btn').onclick = () => sb.auth.signOut();
  } else {
    ui.innerHTML = '';
    emailLine.hidden = true;
  }
}

/* ---------- Tasks ---------- */
function visibleTasks() {
  const pri = { high: 0, mid: 1, low: 2 };
  return state.tasks
    .filter((t) => (state.view === 'all' || t.subject === state.view) && (!day || t.due === day))
    .sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999') || pri[a.pri] - pri[b.pri]);
}

function renderTasks() {
  const all = state.view === 'all';
  let title = all ? '# All tasks' : '# ' + subjectName(state.view);
  if (day) title += ' · ' + short(day);
  $('pane-title').textContent = title;
  $('del-subject').classList.toggle('hidden', all);

  const list = visibleTasks();
  const done = list.filter((t) => t.done).length;
  $('pane-stat').textContent = `Done: ${done}/${list.length}`;

  const ul = $('task-list');
  ul.innerHTML = '';
  list.forEach((t) => {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'check'; cb.checked = t.done;
    cb.onchange = () => toggleDone(t.id, cb.checked);
    const main = document.createElement('div');
    main.className = 't-main';
    const text = document.createElement('div');
    text.className = 't-text'; text.textContent = t.text;
    const meta = document.createElement('div');
    meta.className = 't-meta';
    const chips = [];
    if (all) chips.push(`<span class="chip"># ${esc(subjectName(t.subject))}</span>`);
    if (t.due) chips.push(`<span class="chip${!t.done && t.due < todayStr ? ' late' : ''}">${t.due === todayStr ? 'Today' : short(t.due)}</span>`);
    chips.push(`<span class="chip ${t.pri}">${{ high: 'High', mid: 'Medium', low: 'Low' }[t.pri]}</span>`);
    meta.innerHTML = chips.join('');
    main.append(text, meta);
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '×'; del.setAttribute('aria-label', 'Delete task');
    del.onclick = () => deleteTask(t.id);
    li.append(cb, main, del);
    ul.appendChild(li);
  });
  $('empty').classList.toggle('hidden', list.length > 0);

  const canAdd = !all;
  $('task-input').disabled = !canAdd;
  $('task-input').placeholder = canAdd ? 'Add a task…' : (state.subjects.length ? 'Pick a subject to add tasks' : 'Create a subject first');
  $('task-due').value = day || '';
}

/* ---------- Month window ---------- */
function renderMonth() {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  $('month-title').textContent = `${monthNames[m]} ${y}`;

  // Weekday header
  const wd = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  $('weekdays').innerHTML = wd.map(d => `<span>${d}</span>`).join('');

  // Build day cells
  const first = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();
  const startOffset = first.getDay();
  const totalCells = Math.ceil((startOffset + lastDay) / 7) * 7;

  const wrap = $('days');
  wrap.innerHTML = '';

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(y, m, 1 - startOffset + i);
    const key = iso(cellDate);
    const isCurrentMonth = cellDate.getMonth() === m;
    const n = pending((t) => t.due === key);
    const isToday = key === todayStr;
    const isSelected = key === day;

    const b = document.createElement('button');
    b.className = 'day' + (isToday ? ' today' : '') + (isSelected ? ' selected' : '') + (!isCurrentMonth ? ' faded' : '');
    b.innerHTML = `<strong>${cellDate.getDate()}</strong>${n ? `<span class="count">● ${n}</span>` : ''}`;
    b.onclick = () => {
      day = day === key ? null : key;
      render();
      // On phone, tap a day -> switch to Tasks tab to see filtered list
      if (phoneMQ.matches && day) setTab('tasks');
    };
    wrap.appendChild(b);
  }
}

function render() { renderSidebar(); renderTasks(); renderMonth(); renderChips(); }

/* ---------- Supabase mutations (optimistic) ---------- */
async function addSubject(name) {
  const newId = uid();
  const optimistic = { id: newId, name };
  state.subjects.push(optimistic);
  state.view = newId;
  saveView();
  render();

  const { error } = await sb.from('subjects').insert({ id: newId, name });
  if (error) {
    state.subjects = state.subjects.filter(s => s.id !== newId);
    state.view = 'all';
    saveView();
    render();
    await showMessage({ title: 'Error', message: 'Failed to create subject: ' + error.message });
  }
}

async function deleteSubject(subId) {
  const sub = state.subjects.find(s => s.id === subId);
  if (!sub) return;
  const n = state.tasks.filter(t => t.subject === subId).length;
  const confirmed = await askConfirm({
    title: 'Delete Subject',
    message: `Delete "${sub.name}"${n ? ` and its ${n} task${n > 1 ? 's' : ''}` : ''}?`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true
  });
  if (!confirmed) return;

  // Optimistic
  const oldSubjects = [...state.subjects];
  const oldTasks = [...state.tasks];
  state.subjects = state.subjects.filter(s => s.id !== subId);
  state.tasks = state.tasks.filter(t => t.subject !== subId);
  state.view = 'all';
  saveView();
  render();

  const { error } = await sb.from('subjects').delete().eq('id', subId);
  if (error) {
    state.subjects = oldSubjects;
    state.tasks = oldTasks;
    render();
    await showMessage({ title: 'Error', message: 'Failed to delete subject: ' + error.message });
  }
}

async function addTask(text, subjectId, due, pri) {
  const newId = uid();
  const optimistic = { id: newId, subject: subjectId, text, due, done: false, pri };
  state.tasks.push(optimistic);
  render();

  const { error } = await sb.from('tasks').insert({
    id: newId, subject_id: subjectId, text, due: due || null, done: false, pri
  });
  if (error) {
    state.tasks = state.tasks.filter(t => t.id !== newId);
    render();
    await showMessage({ title: 'Error', message: 'Failed to add task: ' + error.message });
  }
}

async function toggleDone(taskId, done) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const oldDone = task.done;
  task.done = done;
  render();

  const { error } = await sb.from('tasks').update({ done }).eq('id', taskId);
  if (error) {
    task.done = oldDone;
    render();
    await showMessage({ title: 'Error', message: 'Failed to update task: ' + error.message });
  }
}

async function deleteTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const oldTasks = [...state.tasks];
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  render();

  const { error } = await sb.from('tasks').delete().eq('id', taskId);
  if (error) {
    state.tasks = oldTasks;
    render();
    await showMessage({ title: 'Error', message: 'Failed to delete task: ' + error.message });
  }
}

/* ---------- Friendly error mapping ---------- */
function friendlyError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('Invalid login credentials') || msg.includes('Email not confirmed')) return 'Invalid email or password';
  if (msg.includes('User already registered')) return 'An account with this email already exists';
  if (msg.includes('Password should be at least 6 characters')) return 'Password must be at least 6 characters';
  if (msg.includes('Unable to validate email address')) return 'Please enter a valid email address';
  if (msg.includes('rate limit')) return 'Too many attempts. Please wait a moment.';
  if (msg.includes('Email not confirmed')) return 'Please confirm your email first.';
  return msg;
}

/* ---------- Auth forms ---------- */
// Log In form
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const remember = $('remember-me').checked;
  const errEl = $('login-error');
  const btn = $('login-submit');
  hideError(errEl);
  btn.classList.add('loading');
  btn.disabled = true;

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    showError(errEl, friendlyError(error));
    btn.classList.remove('loading');
    btn.disabled = false;
    return;
  }
  // Session will be set, onAuthStateChange handles the rest
  // Persist session if remember me
  if (!remember) {
    const { data: { session } } = await sb.auth.getSession();
    // Session is already in localStorage by default, nothing extra needed
  }
});

$('forgot-link').onclick = (e) => { e.preventDefault(); showAuthForm('forgot-form'); };
$('switch-signup').onclick = (e) => { e.preventDefault(); showAuthForm('signup-form'); };

// Sign Up form
$('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const first = $('signup-first').value.trim();
  const last = $('signup-last').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const confirm = $('signup-confirm').value;
  const errEl = $('signup-error');
  const btn = $('signup-submit');
  hideError(errEl);
  btn.classList.add('loading');
  btn.disabled = true;

  if (!first || !last) { showError(errEl, 'Enter your name'); btn.classList.remove('loading'); btn.disabled = false; return; }
  if (!email || !password) { showError(errEl, 'Enter email and password'); btn.classList.remove('loading'); btn.disabled = false; return; }
  if (password.length < 6) { showError(errEl, 'Password must be at least 6 characters'); btn.classList.remove('loading'); btn.disabled = false; return; }
  if (password !== confirm) { showError(errEl, 'Passwords do not match'); btn.classList.remove('loading'); btn.disabled = false; return; }

  const { error } = await sb.auth.signUp({
    email,
    password,
    data: { full_name: `${first} ${last}` }
  });
  if (error) {
    showError(errEl, friendlyError(error));
    btn.classList.remove('loading');
    btn.disabled = false;
    return;
  }
  // If email confirmation is off, user is signed in immediately
  // If on, they need to check email - show friendly message
  showError(errEl, 'Check your email to confirm your account.');
  btn.classList.remove('loading');
  btn.disabled = false;
});

$('switch-login').onclick = (e) => { e.preventDefault(); showAuthForm('login-form'); };

// Forgot Password form
$('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('forgot-email').value.trim();
  const errEl = $('forgot-error');
  const btn = $('forgot-submit');
  hideError(errEl);
  btn.classList.add('loading');
  btn.disabled = true;

  if (!email) { showError(errEl, 'Enter your email'); btn.classList.remove('loading'); btn.disabled = false; return; }

  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    showError(errEl, friendlyError(error));
    btn.classList.remove('loading');
    btn.disabled = false;
    return;
  }
  showError(errEl, 'If that email exists, a reset link has been sent.');
  btn.classList.remove('loading');
  btn.disabled = false;
});

$('forgot-back').onclick = (e) => { e.preventDefault(); showAuthForm('login-form'); };

// Reset Password form (after clicking link in email)
$('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('reset-password').value;
  const confirm = $('reset-confirm').value;
  const errEl = $('reset-error');
  const btn = $('reset-submit');
  hideError(errEl);
  btn.classList.add('loading');
  btn.disabled = true;

  if (password.length < 6) { showError(errEl, 'Password must be at least 6 characters'); btn.classList.remove('loading'); btn.disabled = false; return; }
  if (password !== confirm) { showError(errEl, 'Passwords do not match'); btn.classList.remove('loading'); btn.disabled = false; return; }

  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    showError(errEl, friendlyError(error));
    btn.classList.remove('loading');
    btn.disabled = false;
    return;
  }
  // Password updated, user is now signed in - onAuthStateChange will show app
  btn.classList.remove('loading');
  btn.disabled = false;
});

// Back button in auth titlebar
$('auth-back').onclick = () => {
  const visible = ['login-form', 'signup-form', 'forgot-form', 'reset-form'].find(id => !$(id).classList.contains('hidden'));
  if (visible === 'signup-form' || visible === 'forgot-form' || visible === 'reset-form') {
    showAuthForm('login-form');
  }
};

/* ---------- Focus timer ---------- */
// Timer state
let timerEnd = null;           // end timestamp (ms)
let timerRemaining = 0;        // remaining ms when paused
let timerTick = null;          // setInterval id
let timerRunning = false;

// Preset lengths (seconds) - loaded from localStorage
const PRESET_KEY = 'my-planner-timer-presets';
let presets = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
let currentMode = 'focus';     // 'focus' | 'short' | 'long'

// Audio
let audioCtx = null;

// Tab title flashing
let flashInterval = null;
const originalTitle = 'My Planner';

// Alarm button state
const alarmBtn = document.getElementById('alarm-btn');
const alarmLabel = document.getElementById('alarm-label');
let alarmOn = true;
try { alarmOn = localStorage.getItem('planner-alarm') !== 'off'; } catch (e) {}

let ringTimer = null, ringStop = null, ringing = false;

function paintAlarmBtn() {
  if (!alarmBtn) return;
  alarmBtn.classList.toggle('off', !alarmOn && !ringing);
  alarmBtn.classList.toggle('ringing', ringing);
  alarmBtn.setAttribute('aria-pressed', String(alarmOn));
  if (alarmLabel) alarmLabel.textContent = ringing ? 'Stop alarm' : (alarmOn ? 'Alarm: ON' : 'Alarm: OFF');
}

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

function beep(at) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square'; o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(at); o.stop(at + 0.18);
}

function startAlarm() {
  if (!alarmOn) return;
  unlockAudio();
  if (!audioCtx) return;
  ringing = true; paintAlarmBtn();
  const pattern = () => { const t = audioCtx.currentTime; beep(t); beep(t + 0.25); beep(t + 0.5); };
  pattern();
  ringTimer = setInterval(pattern, 1500);
  ringStop = setTimeout(stopAlarm, 60000);
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
}

function stopAlarm() {
  clearInterval(ringTimer); clearTimeout(ringStop);
  ringTimer = ringStop = null;
  ringing = false; paintAlarmBtn();
  if (navigator.vibrate) navigator.vibrate(0);
}

// Load presets from localStorage
function loadTimerPrefs() {
  try {
    const saved = localStorage.getItem(PRESET_KEY);
    if (saved) {
      const p = JSON.parse(saved);
      // Migrate old minute-based values to seconds
      for (const k of Object.keys(p)) {
        if (p[k] < 1000) p[k] *= 60; // values < 1000 were minutes
      }
      presets = { ...presets, ...p };
    }
  } catch (e) {}
  updateModeButtons();
  paintAlarmBtn();
  updateTimeDisplay();
}

function saveTimerPrefs() {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); } catch (e) {}
}

// Format seconds to H:MM:SS (if >= 1h) or MM:SS
const fmtSec = (sec) => {
  const totalSec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function getModeLength(mode) {
  return presets[mode] || presets.focus;
}

function setModeLength(mode, seconds) {
  const clamped = Math.max(1, Math.min(24 * 3600, Math.round(seconds)));
  presets[mode] = clamped;
  saveTimerPrefs();
}

function updateModeButtons() {
  document.querySelectorAll('.mode').forEach(b => {
    const mode = b.dataset.mode;
    b.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    b.classList.toggle('active', mode === currentMode);
  });
}

function updateTimeDisplay() {
  const totalSec = getModeLength(currentMode);
  const remainingSec = timerRunning ? Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000)) : Math.ceil(timerRemaining / 1000);
  const displaySec = timerRunning ? remainingSec : totalSec;
  $('time').textContent = fmtSec(displaySec);

  // Add/remove long-format class for font scaling
  $('time').classList.toggle('long-format', displaySec >= 3600);

  // Progress bar
  const bar = $('progress-bar');
  if (bar) {
    const totalMs = getModeLength(currentMode) * 1000;
    const remMs = timerRunning ? Math.max(0, timerEnd - Date.now()) : timerRemaining || totalMs;
    const pct = totalMs > 0 ? (remMs / totalMs) * 100 : 100;
    bar.style.width = `${pct}%`;
  }

  // +/- buttons disabled when running
  $('timer-dec').disabled = timerRunning;
  $('timer-inc').disabled = timerRunning;
}

function updateTabTitle() {
  if (timerRunning) {
    const rem = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
    document.title = `${fmtSec(rem)} - ${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}`;
  } else {
    document.title = originalTitle;
  }
}

// Timer tick (250ms)
function tick() {
  if (!timerRunning) return;
  const rem = timerEnd - Date.now();
  if (rem <= 0) {
    timerRunning = false;
    timerEnd = null;
    clearInterval(timerTick);
    timerTick = null;
    $('start').textContent = 'Start';
    updateTimeDisplay();
    timerFinished();
    return;
  }
  updateTimeDisplay();
  updateTabTitle();
}

function timerFinished() {
  startAlarm();
  // Reset to mode's full length for next run
  timerRemaining = getModeLength(currentMode) * 1000;
  updateTimeDisplay();

  showMessage({
    title: 'Timer',
    message: 'Time\'s up! ✿',
    confirmText: 'Stop alarm',
    cancelText: 'Start Short Break'
  }).then(() => {
    stopAlarm();
  }).catch(() => {
    stopAlarm();
    // Start short break
    switchMode('short', true);
  });
}

async function switchMode(mode, force = false) {
  if (timerRunning && !force) {
    const ok = await askConfirm({
      title: 'Stop Timer?',
      message: 'Switching modes will stop the current timer.',
      confirmText: 'Stop & Switch',
      cancelText: 'Cancel',
      danger: false
    });
    if (!ok) return;
  }
  stopTimer();
  stopAlarm(); // stop ringing if mode changes while ringing
  currentMode = mode;
  updateModeButtons();
  timerRemaining = getModeLength(currentMode) * 1000;
  updateTimeDisplay();
}

function stopTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  if (timerTick) { clearInterval(timerTick); timerTick = null; }
  timerRemaining = Math.max(0, timerEnd - Date.now());
  timerEnd = null;
  $('start').textContent = 'Start';
  updateTimeDisplay();
  updateTabTitle();
}

function startTimer() {
  if (timerRunning) { stopTimer(); return; }

  // Request notification permission on first start
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  unlockAudio(); // prime audio on first click
  timerRunning = true;
  timerEnd = Date.now() + timerRemaining;
  $('start').textContent = 'Pause';
  tick();
  timerTick = setInterval(tick, 250);
}

function resetTimer() {
  stopTimer();
  stopAlarm();
  timerRemaining = getModeLength(currentMode) * 1000;
  updateTimeDisplay();
}

/* ----- Event handlers ----- */
$('start').onclick = () => {
  startTimer();
};

$('reset').onclick = resetTimer;

// Alarm button
if (alarmBtn) {
  alarmBtn.addEventListener('click', () => {
    unlockAudio();
    if (ringing) { stopAlarm(); return; }
    alarmOn = !alarmOn;
    try { localStorage.setItem('planner-alarm', alarmOn ? 'on' : 'off'); } catch (e) {}
    paintAlarmBtn();
    if (alarmOn && audioCtx) beep(audioCtx.currentTime);
  });
}

// Mode buttons
document.querySelectorAll('.mode').forEach(b => {
  b.onclick = () => switchMode(b.dataset.mode);
});

// +/- buttons (hold to repeat)
let adjTimer = null;
function adjStep(delta) {
  if (timerRunning) return;
  const currentSec = timerRemaining / 1000 || getModeLength(currentMode);
  const step = currentSec >= 3600 ? 300 : 60; // 5 min at 1h+, 1 min under
  const newSec = Math.max(1, Math.min(24 * 3600, currentSec + delta * step));
  timerRemaining = newSec * 1000;
  setModeLength(currentMode, newSec);
  updateTimeDisplay();
}

function startAdjRepeat(delta) {
  adjStep(delta);
  adjTimer = setInterval(() => adjStep(delta), 200);
}
function stopAdjRepeat() {
  if (adjTimer) { clearInterval(adjTimer); adjTimer = null; }
}

$('timer-dec').onmousedown = (e) => { e.preventDefault(); startAdjRepeat(-1); };
$('timer-dec').onmouseup = $('timer-dec').onmouseleave = stopAdjRepeat;
$('timer-dec').ontouchstart = (e) => { e.preventDefault(); startAdjRepeat(-1); };
$('timer-dec').ontouchend = $('timer-dec').ontouchcancel = stopAdjRepeat;

$('timer-inc').onmousedown = (e) => { e.preventDefault(); startAdjRepeat(1); };
$('timer-inc').onmouseup = $('timer-inc').onmouseleave = stopAdjRepeat;
$('timer-inc').ontouchstart = (e) => { e.preventDefault(); startAdjRepeat(1); };
$('timer-inc').ontouchend = $('timer-inc').ontouchcancel = stopAdjRepeat;

// Click time to edit - shows 3 inputs: Hours, Minutes, Seconds
const timeEl = $('time');
let editing = false;

timeEl.onclick = () => {
  if (timerRunning || editing) return;
  startEdit();
};

timeEl.onkeydown = (e) => {
  if (e.key === 'Enter' && !timerRunning) startEdit();
  else if (e.key === 'Escape' && editing) cancelEdit();
};

function startEdit() {
  editing = true;
  const currentSec = Math.round(timerRemaining / 1000) || getModeLength(currentMode);
  const h = Math.floor(currentSec / 3600);
  const m = Math.floor((currentSec % 3600) / 60);
  const s = currentSec % 60;

  timeEl.innerHTML = `
    <div class="time-edit">
      <div class="time-edit-field">
        <input type="number" min="0" max="23" value="${h}" aria-label="Hours" data-field="h">
        <span class="time-edit-label">h</span>
      </div>
      <div class="time-edit-field">
        <input type="number" min="0" max="59" value="${m}" aria-label="Minutes" data-field="m">
        <span class="time-edit-label">m</span>
      </div>
      <div class="time-edit-field">
        <input type="number" min="0" max="59" value="${s}" aria-label="Seconds" data-field="s">
        <span class="time-edit-label">s</span>
      </div>
    </div>
  `;
  const inputs = timeEl.querySelectorAll('input');
  inputs[0].focus();
  inputs[0].select();

  function finishEdit() {
    const hVal = Math.max(0, Math.min(23, parseInt(inputs[0].value, 10) || 0));
    const mVal = Math.max(0, Math.min(59, parseInt(inputs[1].value, 10) || 0));
    const sVal = Math.max(0, Math.min(59, parseInt(inputs[2].value, 10) || 0));
    const totalSec = hVal * 3600 + mVal * 60 + sVal;

    if (totalSec >= 1 && totalSec <= 24 * 3600) {
      timerRemaining = totalSec * 1000;
      setModeLength(currentMode, totalSec);
    }
    editing = false;
    updateTimeDisplay();
  }

  inputs.forEach((input, i) => {
    input.onblur = finishEdit;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit();
      } else if (e.key === 'Escape') {
        editing = false;
        updateTimeDisplay();
      } else if (e.key === 'Tab' && !e.shiftKey && i < inputs.length - 1) {
        inputs[i + 1].focus();
        inputs[i + 1].select();
        e.preventDefault();
      } else if (e.key === 'Tab' && e.shiftKey && i > 0) {
        inputs[i - 1].focus();
        inputs[i - 1].select();
        e.preventDefault();
      }
    };
  });
}

function cancelEdit() {
  editing = false;
  updateTimeDisplay();
}

// Init timer prefs on load
loadTimerPrefs();

// Expose for debugging
window.__timerDebug = { presets, get currentMode() { return currentMode; }, get running() { return timerRunning; } };

/* ---------- Events ---------- */
$('nav-all').onclick = () => { state.view = 'all'; saveView(); render(); };
$('add-subject').onclick = async () => {
  while (true) {
    const name = await askText({
      title: 'New Subject',
      label: 'Subject name',
      placeholder: 'e.g. ITP 131 - Networking 2',
      confirmText: 'Add'
    }).catch(() => null);
    if (name === null) return; // cancelled
    if (!name.trim()) continue; // empty - show error inside modal
    // Check for duplicate
    if (state.subjects.some(s => s.name.toLowerCase() === name.trim().toLowerCase())) {
      // Show error inside modal by reopening with error - but we need a different approach
      // We'll handle this by just showing message and retrying
      await showMessage({ title: 'Error', message: 'A subject with this name already exists' });
      continue;
    }
    addSubject(name);
    break;
  }
};
$('del-subject').onclick = () => {
  if (state.view === 'all') return;
  deleteSubject(state.view);
};
$('rename-subject').onclick = () => {
  if (state.view === 'all') return;
  renameSubject(state.view);
};

async function renameSubject(subId) {
  const sub = state.subjects.find(s => s.id === subId);
  if (!sub) return;
  while (true) {
    const name = await askText({
      title: 'Rename Subject',
      label: 'Subject name',
      placeholder: 'e.g. ITP 131 - Networking 2',
      confirmText: 'Save',
      value: sub.name
    }).catch(() => null);
    if (name === null) return; // cancelled
    if (!name.trim()) continue; // empty - show error inside modal
    // Check for duplicate (excluding current)
    if (state.subjects.some(s => s.id !== subId && s.name.toLowerCase() === name.trim().toLowerCase())) {
      await showMessage({ title: 'Error', message: 'A subject with this name already exists' });
      continue;
    }
    // Optimistic update
    const oldName = sub.name;
    sub.name = name.trim();
    render();

    const { error } = await sb.from('subjects').update({ name: name.trim() }).eq('id', subId);
    if (error) {
      sub.name = oldName;
      render();
      await showMessage({ title: 'Error', message: 'Failed to rename subject: ' + error.message });
    }
    break;
  }
}
$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('task-input').value.trim();
  if (!text || state.view === 'all') return;
  addTask(text, state.view, $('task-due').value, $('task-pri').value);
  $('task-input').value = '';
});
$('prev-month').onclick = () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1); renderMonth(); };
$('next-month').onclick = () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1); renderMonth(); };
$('today-btn').onclick = () => { monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1); day = todayStr; render(); };

/* ---------- Phone layout ---------- */
const phoneMQ = window.matchMedia('(max-width: 699px)');

function setTab(tab) {
  if (!phoneMQ.matches) return;
  // Update tab bar
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Show/hide panels
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  // FAB only on tasks tab (CSS uses display: grid)
  $('fab').style.display = tab === 'tasks' ? 'grid' : 'none';
}

function renderChips() {
  if (!phoneMQ.matches) return;
  const chipsEl = $('chips');
  if (!chipsEl) return;
  chipsEl.innerHTML = '';
  // All chip
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (state.view === 'all' ? ' active' : '');
  allChip.textContent = 'All';
  allChip.onclick = () => { state.view = 'all'; saveView(); render(); };
  chipsEl.appendChild(allChip);
  // Subject chips
  state.subjects.forEach(s => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.view === s.id ? ' active' : '');
    const n = pending((t) => t.subject === s.id);
    chip.textContent = '# ' + esc(s.name) + (n ? ` (${n})` : '');
    chip.onclick = () => { state.view = s.id; saveView(); render(); };
    chipsEl.appendChild(chip);
  });
  // + Subject chip
  const addChip = document.createElement('button');
  addChip.className = 'chip';
  addChip.textContent = '+ Subject';
  addChip.onclick = () => $('add-subject').click();
  chipsEl.appendChild(addChip);
}

/* Sheet (add task on phone) */
function openSheet() {
  $('sheet-overlay').hidden = false;
  $('sheet').hidden = false;
  $('sheet-text').value = '';
  $('sheet-due').value = day || '';
  $('sheet-pri').value = 'mid';
  $('sheet-err').textContent = '';
  setTimeout(() => $('sheet-text').focus(), 50);
  // Lock body scroll
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('sheet-overlay').hidden = true;
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}

$('fab').onclick = openSheet;
$('sheet-overlay').onclick = closeSheet;
$('sheet-cancel').onclick = closeSheet;

$('sheet').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('sheet-text').value.trim();
  if (!text) { $('sheet-err').textContent = 'Enter a task name'; return; }
  if (state.view === 'all') { $('sheet-err').textContent = 'Select a subject first'; return; }
  addTask(text, state.view, $('sheet-due').value, $('sheet-pri').value);
  closeSheet();
});

/* Tab click handlers */
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => setTab(btn.dataset.tab);
});

/* Listen for media query changes */
phoneMQ.addEventListener('change', () => {
  if (phoneMQ.matches) {
    setTab('tasks');
  } else {
    // Reset desktop panels
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.remove('active'));
    $('fab').style.display = 'none';
  }
});

/* ---------- Init ---------- */
tryAutoLogin(); showTime();