const STORAGE_KEY = 'repair-jobs-v1';
const FUEL_CONSUMPTION = 7;
const FUEL_PRICE = 1.6;
const GOOGLE_CLIENT_ID = '298331612158-3hmsvel6fnph3ep8f9s2p1kti141hrce.apps.googleusercontent.com';
const SPREADSHEET_ID = '19xL6uLxnZWO4mzWoI-j_VmjBPPRzhjwasJq9Ql951jI';
const SHEET_NAME = 'Клиенты';
const ALLOWED_EMAIL = 'service.rollershutter@gmail.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';
const SHEET_HEADERS = [
  'ID', 'Дата', 'Статус', 'Имя', 'Телефон', 'Адрес', 'Стоимость ремонта, €',
  'Расстояние в одну сторону, км', 'Расстояние туда и обратно, км', 'Топливо, л',
  'Затраты на бензин, €', 'Комплектующие, €', 'Все расходы, €', 'Прибыль, €',
  'Комментарий', 'Обновлено', 'Дата выполнения'
];

const $ = id => document.getElementById(id);
const jobDialog = $('jobDialog');
const settingsDialog = $('settingsDialog');
const jobForm = $('jobForm');

let jobs = readJson(STORAGE_KEY, []);
let accessToken = '';
let tokenClient;
let tokenPromise;
let connectedEmail = '';

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  render();
}

function numberValue(id) {
  return Math.max(0, Number.parseFloat($(id).value.replace(',', '.')) || 0);
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(value || 0);
}

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function calculations(values) {
  const distanceKm = Math.max(0, Number(values.distanceKm) || 0);
  const roundTripKm = distanceKm * 2;
  const fuelLiters = roundTripKm * FUEL_CONSUMPTION / 100;
  const fuelCost = fuelLiters * FUEL_PRICE;
  const partsCost = Math.max(0, Number(values.partsCost) || 0);
  const repairPrice = Math.max(0, Number(values.repairPrice) || 0);
  const totalCosts = partsCost + fuelCost;
  const profit = repairPrice - totalCosts;
  return { roundTripKm, fuelLiters, fuelCost, totalCosts, profit };
}

function updateCalculations() {
  const calc = calculations({
    distanceKm: numberValue('distanceKm'),
    partsCost: numberValue('partsCost'),
    repairPrice: numberValue('repairPrice')
  });
  $('roundTripKm').textContent = `${calc.roundTripKm.toFixed(1)} км`;
  $('fuelCost').textContent = money(calc.fuelCost);
  $('totalCosts').textContent = money(calc.totalCosts);
  $('profit').textContent = money(calc.profit);
  $('profit').classList.toggle('negative', calc.profit < 0);
}

function today() { return new Date().toISOString().slice(0, 10); }

function openNewJob(prefill = {}) {
  jobForm.reset();
  $('jobId').value = '';
  $('jobDialogTitle').textContent = 'Новая заявка';
  $('status').value = 'Взято в работу';
  $('date').value = today();
  $('scheduledDate').value = '';
  $('name').value = prefill.name || '';
  $('phone').value = prefill.phone || '';
  $('comment').value = prefill.comment || '';
  ['repairPrice', 'partsCost', 'distanceKm'].forEach(id => $(id).value = '0');
  updateCalculations();
  jobDialog.showModal();
}

function editJob(id) {
  const job = jobs.find(item => item.id === id);
  if (!job) return;
  $('jobDialogTitle').textContent = 'Редактирование заявки';
  ['id','status','date','scheduledDate','name','phone','address','repairPrice','partsCost','distanceKm','comment'].forEach(field => {
    const element = field === 'id' ? $('jobId') : $(field);
    element.value = job[field] ?? '';
  });
  updateCalculations();
  jobDialog.showModal();
}

function formJob() {
  const base = {
    id: $('jobId').value || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    status: $('status').value,
    date: $('date').value,
    scheduledDate: $('scheduledDate').value,
    name: $('name').value.trim(),
    phone: $('phone').value.trim(),
    address: $('address').value.trim(),
    repairPrice: numberValue('repairPrice'),
    partsCost: numberValue('partsCost'),
    distanceKm: numberValue('distanceKm'),
    comment: $('comment').value.trim(),
    updatedAt: new Date().toISOString(),
    synced: false
  };
  return { ...base, ...calculations(base) };
}

function statusClass(status) {
  if (status === 'Выполнено') return 'done';
  if (status === 'Назначено') return 'assigned';
  if (status === 'Отказ') return 'cancelled';
  return '';
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function phoneDigits(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
}

function render() {
  const completed = jobs.filter(j => j.status === 'Выполнено');
  const revenue = completed.reduce((sum, j) => sum + j.repairPrice, 0);
  const profit = completed.reduce((sum, j) => sum + j.profit, 0);
  $('summary').innerHTML = `
    <div class="summary-card"><span>В работе</span><strong>${jobs.filter(j => !['Выполнено','Отказ'].includes(j.status)).length}</strong></div>
    <div class="summary-card"><span>Выручка</span><strong>${money(revenue)}</strong></div>
    <div class="summary-card"><span>Прибыль</span><strong>${money(profit)}</strong></div>`;

  const filter = $('statusFilter').value;
  const visible = jobs.filter(j => filter === 'all' || j.status === filter).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('emptyState').hidden = visible.length !== 0;
  $('jobsList').innerHTML = visible.map(job => {
    const digits = phoneDigits(job.phone);
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`;
    const wa = `https://wa.me/${digits}`;
    const dueToday = job.scheduledDate === today() && !['Выполнено','Отказ'].includes(job.status);
    return `<article class="job-card ${dueToday ? 'due-today' : ''}" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        <div class="job-top"><div><h2>${escapeHtml(job.name || 'Без имени')}</h2><p class="job-phone">${escapeHtml(job.phone || 'Телефон не указан')} · ${escapeHtml(job.date)}</p></div><span class="status ${statusClass(job.status)}">${escapeHtml(job.status)}</span></div>
        ${job.address ? `<p class="job-address">📍 ${escapeHtml(job.address)}</p>` : ''}
        ${job.scheduledDate ? `<p class="job-scheduled">🗓 Выполнить: ${escapeHtml(formatDate(job.scheduledDate))}${dueToday ? ' · СЕГОДНЯ' : ''}</p>` : ''}
        ${job.comment ? `<p class="job-comment">💬 ${escapeHtml(job.comment)}</p>` : ''}
        <div class="money-row"><div><span>Ремонт</span><strong>${money(job.repairPrice)}</strong></div><div><span>Расходы</span><strong>${money(job.totalCosts)}</strong></div><div><span>Прибыль</span><strong>${money(job.profit)}</strong></div></div>
      </div>
      <div class="job-actions">
        <a href="${digits ? wa : '#'}" target="_blank" aria-label="Написать в WhatsApp">💬</a>
        <a href="${digits ? `tel:+${digits}` : '#'}" aria-label="Позвонить">☎</a>
        <a href="${job.address ? maps : '#'}" target="_blank" aria-label="Открыть адрес на карте">📍</a>
        <button class="edit" aria-label="Редактировать">✎</button>
        <button class="sync ${job.synced ? 'synced' : ''}" aria-label="Отправить в Google Таблицу">${job.synced ? '✓' : '☁'}</button>
      </div>
    </article>`;
  }).join('');
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}

function updateAccountStatus() {
  const connected = connectedEmail === ALLOWED_EMAIL && Boolean(accessToken);
  $('accountStatus').classList.toggle('connected', connected);
  $('accountTitle').textContent = connected ? 'Google подключён' : 'Google не подключён';
  $('accountHelp').textContent = connected ? connectedEmail : `Войдите как ${ALLOWED_EMAIL}`;
  $('googleLoginButton').textContent = connected ? 'Войти заново' : 'Войти через Google';
  $('refreshJobsButton').hidden = !connected;
}

function initGoogleLogin() {
  if (!window.google?.accounts?.oauth2) return false;
  if (tokenClient) return true;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: response => {
      if (response.error) tokenPromise?.reject(new Error(response.error));
      else tokenPromise?.resolve(response.access_token);
      tokenPromise = null;
    },
    error_callback: error => {
      tokenPromise?.reject(new Error(error.type || 'Не удалось открыть вход Google'));
      tokenPromise = null;
    }
  });
  return true;
}

async function requestGoogleAccess() {
  if (accessToken && connectedEmail === ALLOWED_EMAIL) return accessToken;
  if (!initGoogleLogin()) throw new Error('Google ещё загружается. Повторите через несколько секунд.');
  const token = await new Promise((resolve, reject) => {
    tokenPromise = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  });
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!profileResponse.ok) throw new Error('Не удалось проверить Google-аккаунт');
  const profile = await profileResponse.json();
  if ((profile.email || '').toLowerCase() !== ALLOWED_EMAIL) {
    google.accounts.oauth2.revoke(token);
    accessToken = '';
    connectedEmail = '';
    updateAccountStatus();
    throw new Error(`Нужен аккаунт ${ALLOWED_EMAIL}`);
  }
  accessToken = token;
  connectedEmail = profile.email.toLowerCase();
  updateAccountStatus();
  return token;
}

async function sheetsRequest(url, options = {}) {
  const token = await requestGoogleAccess();
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 401) {
    accessToken = '';
    connectedEmail = '';
    updateAccountStatus();
  }
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error?.message || 'Google Таблица не приняла данные');
  }
  return response.json();
}

function sheetRow(job) {
  return [[
    job.id, job.date, job.status, job.name, job.phone, job.address,
    job.repairPrice, job.distanceKm, job.roundTripKm, job.fuelLiters,
    job.fuelCost, job.partsCost, job.totalCosts, job.profit, job.comment,
    job.updatedAt, job.scheduledDate || ''
  ]];
}

function numberFromSheet(value) {
  return Math.max(0, Number(String(value ?? '').replace(',', '.')) || 0);
}

function jobFromSheet(row) {
  const base = {
    id: String(row[0] || ''), date: String(row[1] || ''), status: String(row[2] || 'Взято в работу'),
    name: String(row[3] || ''), phone: String(row[4] || ''), address: String(row[5] || ''),
    repairPrice: numberFromSheet(row[6]), distanceKm: numberFromSheet(row[7]),
    roundTripKm: numberFromSheet(row[8]), fuelLiters: numberFromSheet(row[9]),
    fuelCost: numberFromSheet(row[10]), partsCost: numberFromSheet(row[11]),
    totalCosts: numberFromSheet(row[12]), profit: Number(String(row[13] ?? '').replace(',', '.')) || 0,
    comment: String(row[14] || ''), updatedAt: String(row[15] || ''),
    scheduledDate: String(row[16] || ''), synced: true
  };
  return { ...base, ...calculations(base), synced: true };
}

async function loadJobsFromSheet(showMessage = true) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
  await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A1:Q1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: [SHEET_HEADERS] })
  });
  const response = await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A2:Q`)}`);
  const cloudJobs = (response.values || []).filter(row => row[0]).map(jobFromSheet);
  const merged = new Map(jobs.map(job => [String(job.id), job]));
  cloudJobs.forEach(cloudJob => {
    const localJob = merged.get(String(cloudJob.id));
    if (!localJob || !localJob.updatedAt || (cloudJob.updatedAt && cloudJob.updatedAt >= localJob.updatedAt)) {
      merged.set(String(cloudJob.id), cloudJob);
    }
  });
  jobs = [...merged.values()];
  saveJobs();
  if (showMessage) toast(`Загружено заявок: ${cloudJobs.length}`);
}

async function syncPendingJobs() {
  const pending = jobs.filter(job => !job.synced);
  for (const job of pending) await syncJob(job.id, { quiet: true });
  if (pending.length) toast(`Отправлено заявок: ${pending.length}`);
}

async function syncJob(id, options = {}) {
  const job = jobs.find(item => item.id === id);
  if (!job) return;
  try {
    if (!options.quiet) toast('Подключаю Google Таблицу…');
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
    const ids = await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A2:A`)}`);
    const rowIndex = (ids.values || []).findIndex(row => String(row[0]) === String(job.id));
    if (rowIndex >= 0) {
      const rowNumber = rowIndex + 2;
      await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:Q${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT', body: JSON.stringify({ values: sheetRow(job) })
      });
    } else {
      await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A:Q`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: 'POST', body: JSON.stringify({ values: sheetRow(job) })
      });
    }
    job.synced = true;
    job.syncedAt = new Date().toISOString();
    saveJobs();
    if (!options.quiet) toast('Заявка отправлена в Google Таблицу');
  } catch (error) {
    if (!options.quiet) toast(error.message || 'Нет связи. Заявка сохранена на телефоне');
    return false;
  }
  return true;
}

function parseSharedData() {
  const params = new URLSearchParams(location.search);
  if (!params.has('share')) return null;
  const text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n').trim();
  const phone = text.match(/(?:\+?34[\s.-]?)?(?:[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/)?.[0] || '';
  const firstLine = text.split('\n').map(x => x.trim()).find(x => x && !x.includes('http') && x !== phone) || '';
  history.replaceState({}, '', location.pathname);
  return { name: firstLine.slice(0, 60), phone, comment: text.slice(0, 500) };
}

$('newJobButton').addEventListener('click', () => openNewJob());
$('settingsButton').addEventListener('click', () => settingsDialog.showModal());
$('statusFilter').addEventListener('change', render);
['repairPrice','partsCost','distanceKm'].forEach(id => $(id).addEventListener('input', updateCalculations));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => jobDialog.close()));
document.querySelectorAll('.close-settings').forEach(button => button.addEventListener('click', () => settingsDialog.close()));

jobForm.addEventListener('submit', async event => {
  event.preventDefault();
  const job = formJob();
  const index = jobs.findIndex(item => item.id === job.id);
  if (index >= 0) jobs[index] = job; else jobs.push(job);
  saveJobs();
  jobDialog.close();
  if (accessToken && connectedEmail === ALLOWED_EMAIL) {
    const sent = await syncJob(job.id, { quiet: true });
    toast(sent ? 'Заявка сохранена и отправлена ✓' : 'Заявка сохранена на телефоне ☁');
  } else {
    toast('Заявка сохранена на телефоне ☁');
  }
});

$('googleLoginButton').addEventListener('click', async () => {
  accessToken = '';
  connectedEmail = '';
  updateAccountStatus();
  try {
    await requestGoogleAccess();
    await loadJobsFromSheet(false);
    await syncPendingJobs();
    toast('Google подключён, заявки обновлены');
  } catch (error) {
    toast(error.message || 'Не удалось войти через Google');
  }
});

$('refreshJobsButton').addEventListener('click', async () => {
  try {
    await loadJobsFromSheet();
    await syncPendingJobs();
  } catch (error) {
    toast(error.message || 'Не удалось загрузить заявки');
  }
});

$('jobsList').addEventListener('click', event => {
  const card = event.target.closest('.job-card');
  if (!card) return;
  if (event.target.closest('.edit')) editJob(card.dataset.id);
  if (event.target.closest('.sync')) syncJob(card.dataset.id);
});

updateAccountStatus();
render();
const shared = parseSharedData();
if (shared) openNewJob(shared);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
