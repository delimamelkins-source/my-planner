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
  $('auth-title').textContent = titles[formId];
  $('auth-back').classList.toggle('hidden', formId === 'login-form' && formId === 'signup-form');
  hideError($('auth-error'));
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
    alert('Failed to load data: ' + e.message);
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

  if (!confirm('Import tasks from this browser?')) {
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
    li.appendChild(b);
    ul.appendChild(li);
  });
  $('no-subjects').classList.toggle('hidden', state.subjects.length > 0);

  // User info in titlebar (upper right)
  const ui = $('user-info');
  if (state.user?.email) {
    ui.innerHTML = `<span style="font-size: .8rem; color: var(--grey); margin-right: 8px;">${esc(state.user.email)}</span>
      <button class="btn" id="logout-btn" style="padding: 3px 8px; font-size: .75rem;">Log out</button>`;
    $('logout-btn').onclick = () => sb.auth.signOut();
  } else {
    ui.innerHTML = '';
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
    b.onclick = () => { day = day === key ? null : key; render(); };
    wrap.appendChild(b);
  }
}

function render() { renderSidebar(); renderTasks(); renderMonth(); }

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
    alert('Failed to create subject: ' + error.message);
  }
}

async function deleteSubject(subId) {
  const sub = state.subjects.find(s => s.id === subId);
  if (!sub) return;
  const n = state.tasks.filter(t => t.subject === subId).length;
  if (!confirm(`Delete "${sub.name}"${n ? ` and its ${n} task${n > 1 ? 's' : ''}` : ''}?`)) return;

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
    alert('Failed to delete subject: ' + error.message);
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
    alert('Failed to add task: ' + error.message);
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
    alert('Failed to update task: ' + error.message);
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
    alert('Failed to delete task: ' + error.message);
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
  const errEl = $('auth-error');
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
  const errEl = $('auth-error');
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
  const errEl = $('auth-error');
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
  const errEl = $('auth-error');
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
let total = 25 * 60, left = total, ticking = null;
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function showTime() { $('time').textContent = fmt(left); document.title = ticking ? `${fmt(left)} · My Planner` : 'My Planner'; }
function stop() { clearInterval(ticking); ticking = null; $('start').textContent = 'Start'; }
$('start').onclick = () => {
  if (ticking) { stop(); showTime(); return; }
  $('start').textContent = 'Pause';
  ticking = setInterval(() => {
    left--;
    if (left <= 0) { left = 0; stop(); showTime(); alert('Time is up! ✿'); return; }
    showTime();
  }, 1000);
};
$('reset').onclick = () => { stop(); left = total; showTime(); };
document.querySelectorAll('.mode').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.mode').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    stop(); total = left = Number(b.dataset.min) * 60; showTime();
  };
});

/* ---------- Events ---------- */
$('nav-all').onclick = () => { state.view = 'all'; saveView(); render(); };
$('add-subject').onclick = () => {
  const name = (prompt('Subject name?') || '').trim();
  if (!name) return;
  addSubject(name);
};
$('del-subject').onclick = () => {
  if (state.view === 'all') return;
  deleteSubject(state.view);
};
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

/* ---------- Init ---------- */
tryAutoLogin(); showTime();