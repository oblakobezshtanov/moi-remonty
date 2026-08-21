const STORAGE_KEY = 'repair-jobs-v1';
const FUEL_CONSUMPTION = 7;
const FUEL_PRICE = 1.6;
const GOOGLE_CLIENT_ID = '298331612158-3hmsvel6fnph3ep8f9s2p1kti141hrce.apps.googleusercontent.com';
const SPREADSHEET_ID = '19xL6uLxnZWO4mzWoI-j_VmjBPPRzhjwasJq9Ql951jI';
const SHEET_NAME = 'Клиенты';
const ALLOWED_EMAIL = 'service.rollershutter@gmail.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';
const LEGACY_ASSIGNED_STATUS = 'Назначено';
const DEFAULT_STATUS = 'Взято в работу';
const SHEET_HEADERS = [
  'ID', 'Дата', 'Статус', 'Имя', 'Телефон', 'Адрес', 'Стоимость ремонта, €',
  'Расстояние в одну сторону, км', 'Расстояние туда и обратно, км', 'Топливо, л',
  'Затраты на бензин, €', 'Комплектующие, €', 'Все расходы, €', 'Прибыль, €',
  'Комментарий', 'Обновлено', 'Дата выполнения', 'Время с', 'Время до', 'Напоминание отправлено'
];

const $ = id => document.getElementById(id);
const jobDialog = $('jobDialog');
const settingsDialog = $('settingsDialog');
const periodDialog = $('periodDialog');
const jobForm = $('jobForm');

let jobs = readJson(STORAGE_KEY, []).map(normalizeJob);
let accessToken = '';
let tokenClient;
let tokenPromise;
let connectedEmail = '';
let profitPeriod = { type: 'month', from: '', to: '' };

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.map(normalizeJob)));
  render();
}

function normalizeStatus(status) {
  return status === LEGACY_ASSIGNED_STATUS ? DEFAULT_STATUS : (status || DEFAULT_STATUS);
}

function normalizeJob(job = {}) {
  const base = {
    ...job,
    status: normalizeStatus(job.status),
    scheduledFrom: job.scheduledFrom || '',
    scheduledTo: job.scheduledTo || '',
    reminderSentFor: job.reminderSentFor || '',
    synced: Boolean(job.synced)
  };
  return { ...base, ...calculations(base) };
}

function numberValue(id) {
  return Math.max(0, Number.parseFloat($(id).value.replace(',', '.')) || 0);
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' }).format(value || 0);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
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

function dateForStats(job) {
  return job.scheduledDate || job.date || '';
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function openNewJob(prefill = {}) {
  jobForm.reset();
  $('jobId').value = '';
  $('jobDialogTitle').textContent = 'Новая заявка';
  $('status').value = DEFAULT_STATUS;
  $('date').value = today();
  delete $('scheduledDate').dataset.changed;
  $('scheduledDate').value = $('date').value;
  $('timeSlot').value = '';
  $('name').value = prefill.name || '';
  $('phone').value = prefill.phone || '';
  $('comment').value = prefill.comment || '';
  ['repairPrice', 'partsCost', 'distanceKm'].forEach(id => $(id).value = '0');
  resetPhotoFields();
  updateCalculations();
  jobDialog.showModal();
}

function editJob(id) {
  const job = jobs.find(item => item.id === id);
  if (!job) return;
  $('jobDialogTitle').textContent = 'Редактирование заявки';
  $('scheduledDate').dataset.changed = 'true';
  ['id','status','date','scheduledDate','name','phone','address','repairPrice','partsCost','distanceKm','comment'].forEach(field => {
    const element = field === 'id' ? $('jobId') : $(field);
    element.value = field === 'status' ? normalizeStatus(job[field]) : (job[field] ?? '');
  });
  $('timeSlot').value = timeSlotValue(job);
  resetPhotoFields(job);
  updateCalculations();
  jobDialog.showModal();
}

function resetPhotoFields(job = {}) {
  $('photo').value = '';
  $('removePhoto').checked = false;
  $('removePhotoWrap').hidden = !job.photoData;
  $('photoPreview').hidden = !job.photoData;
  $('photoPreview').innerHTML = job.photoData
    ? `Сохранённое фото: ${escapeHtml(job.photoName || 'фото')}<img src="${job.photoData}" alt="Фото заявки">`
    : '';
}

async function formJob() {
  const id = $('jobId').value || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const previous = jobs.find(item => item.id === id) || {};
  let photoData = previous.photoData || '';
  let photoName = previous.photoName || '';
  let photoUpdatedAt = previous.photoUpdatedAt || '';

  if ($('removePhoto').checked) {
    photoData = '';
    photoName = '';
    photoUpdatedAt = '';
  }

  const selectedPhoto = $('photo').files?.[0];
  if (selectedPhoto) {
    const compressed = await compressImage(selectedPhoto);
    photoData = compressed.dataUrl;
    photoName = selectedPhoto.name || 'photo.jpg';
    photoUpdatedAt = new Date().toISOString();
  }

  const [scheduledFrom = '', scheduledTo = ''] = ($('timeSlot').value || '').split('-');
  const base = {
    id,
    status: normalizeStatus($('status').value),
    date: $('date').value,
    scheduledDate: $('scheduledDate').value,
    scheduledFrom,
    scheduledTo,
    name: $('name').value.trim(),
    phone: $('phone').value.trim(),
    address: $('address').value.trim(),
    repairPrice: numberValue('repairPrice'),
    partsCost: numberValue('partsCost'),
    distanceKm: numberValue('distanceKm'),
    comment: $('comment').value.trim(),
    updatedAt: new Date().toISOString(),
    synced: false,
    reminderSentFor: previous.reminderSentFor || '',
    photoData,
    photoName,
    photoUpdatedAt
  };

  const reminderKey = getReminderKey(base);
  if (base.reminderSentFor && base.reminderSentFor !== reminderKey) base.reminderSentFor = '';
  return { ...base, ...calculations(base) };
}

function statusClass(status) {
  if (status === 'Выполнено') return 'done';
  if (status === 'Отказ') return 'cancelled';
  return '';
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatSchedule(job) {
  const date = formatDate(job.scheduledDate);
  const from = job.scheduledFrom;
  const to = job.scheduledTo;
  if (!date) return '';
  if (from && to) return `${date}, ${from}–${to}`;
  if (from) return `${date}, с ${from}`;
  return date;
}

function timeSlotValue(job) {
  return job.scheduledFrom && job.scheduledTo ? `${job.scheduledFrom}-${job.scheduledTo}` : '';
}

function phoneDigits(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 9) digits = `34${digits}`;
  return digits;
}

function mapUrl(location) {
  const value = (location || '').trim();
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}

function currentProfitJobs() {
  const completed = jobs.filter(j => j.status === 'Выполнено');
  if (profitPeriod.type === 'week') return jobsInRange(completed, isoDate(addDays(new Date(), -6)), today());
  if (profitPeriod.type === 'month') return jobsInRange(completed, isoDate(addDays(new Date(), -29)), today());
  if (profitPeriod.type === 'threeMonths') return jobsInRange(completed, isoDate(addDays(new Date(), -89)), today());
  if (profitPeriod.type === 'custom') return jobsInRange(completed, profitPeriod.from, profitPeriod.to);
  return completed;
}

function jobsInRange(source, from, to) {
  return source.filter(job => {
    const date = dateForStats(job);
    return (!from || date >= from) && (!to || date <= to);
  });
}

function recentFromDate() {
  return isoDate(addDays(new Date(), -13));
}

function profitPeriodLabel() {
  if (profitPeriod.type === 'week') return 'за 7 дней';
  if (profitPeriod.type === 'month') return 'за 30 дней';
  if (profitPeriod.type === 'threeMonths') return 'за 3 месяца';
  if (profitPeriod.type === 'custom') return `${formatDate(profitPeriod.from)} — ${formatDate(profitPeriod.to)}`;
  return 'за всё время';
}

function chooseProfitPeriod() {
  periodDialog.showModal();
}

function setProfitPeriod(type) {
  profitPeriod = { type, from: '', to: '' };
  periodDialog.close();
  render();
}

function render() {
  jobs = jobs.map(normalizeJob);
  const active = jobs.filter(j => !['Выполнено','Отказ'].includes(j.status));
  const revenueJobs = currentProfitJobs();
  const revenue = revenueJobs.reduce((sum, j) => sum + j.repairPrice, 0);
  const profit = revenueJobs.reduce((sum, j) => sum + j.profit, 0);
  $('summary').innerHTML = `
    <div class="summary-card"><span>В работе</span><strong>${active.length}</strong></div>
    <div class="summary-card"><span>Выручка ${escapeHtml(profitPeriodLabel())}</span><strong>${money(revenue)}</strong></div>
    <button id="profitSummaryButton" class="summary-card" type="button"><span>Прибыль ${escapeHtml(profitPeriodLabel())}</span><strong>${money(profit)}</strong></button>`;

  const filter = $('statusFilter').value;
  const query = ($('searchInput').value || '').trim().toLowerCase();
  const visible = jobs
    .filter(j => {
      if (filter === 'recent') return jobsInRange([j], recentFromDate(), today()).length > 0;
      return filter === 'all' || j.status === filter;
    })
    .filter(j => !query || `${j.name || ''} ${j.phone || ''}`.toLowerCase().includes(query))
    .sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  $('emptyState').hidden = visible.length !== 0;
  $('jobsList').innerHTML = visible.map(job => {
    const digits = phoneDigits(job.phone);
    const maps = mapUrl(job.address);
    const wa = `https://wa.me/${digits}`;
    const completed = job.status === 'Выполнено';
    const dueToday = job.scheduledDate === today() && !['Выполнено','Отказ'].includes(job.status);
    const schedule = formatSchedule(job);
    const scheduleLabel = completed ? 'Выполнено' : 'Выполнить';
    const scheduleClass = completed ? 'job-scheduled completed' : 'job-scheduled';
    return `<article class="job-card ${dueToday ? 'due-today' : ''}" data-id="${escapeHtml(job.id)}">
      <div class="job-main">
        <div class="job-top"><div><h2>${escapeHtml(job.name || 'Без имени')}</h2><p class="job-phone">${escapeHtml(job.phone || 'Телефон не указан')} · ${escapeHtml(job.date)}</p></div><span class="status ${statusClass(job.status)}">${escapeHtml(job.status)}</span></div>
        ${job.address ? `<p class="job-address">📍 ${escapeHtml(job.address)}</p>` : ''}
        ${schedule ? `<p class="${scheduleClass}">🗓 ${scheduleLabel}: ${escapeHtml(schedule)}${dueToday ? ' · СЕГОДНЯ' : ''}</p>` : ''}
        ${job.comment ? `<p class="job-comment">💬 ${escapeHtml(job.comment)}</p>` : ''}
        ${job.photoData ? `<p class="job-photo">📷 Фото сохранено на этом устройстве</p>` : ''}
        <div class="money-row"><div><span>Ремонт</span><strong>${money(job.repairPrice)}</strong></div><div><span>Расходы</span><strong>${money(job.totalCosts)}</strong></div><div><span>Прибыль</span><strong>${money(job.profit)}</strong></div></div>
      </div>
      <div class="job-actions">
        <a href="${digits ? wa : '#'}" target="_blank" aria-label="Написать в WhatsApp">💬</a>
        <a href="${digits ? `tel:+${digits}` : '#'}" aria-label="Позвонить">☎</a>
        <a href="${job.address ? maps : '#'}" target="_blank" aria-label="Открыть адрес на карте">📍</a>
        <button class="photo-open" aria-label="Открыть фото">📷</button>
        <button class="edit" aria-label="Редактировать">✎</button>
        <button class="sync ${job.synced ? 'synced' : ''}" aria-label="Отправить в Google Таблицу">${job.synced ? '✓' : '☁'}</button>
      </div>
    </article>`;
  }).join('');

  $('profitSummaryButton')?.addEventListener('click', chooseProfitPeriod);
  renderChart();
}

function renderChart() {
  const range = $('chartRange').value;
  const days = range === 'month' ? 30 : 7;
  const dates = Array.from({ length: days }, (_, index) => isoDate(addDays(new Date(), index - days + 1)));
  const rows = dates.map(date => {
    const dayJobs = jobs.filter(job => dateForStats(job) === date);
    const completed = dayJobs.filter(job => job.status === 'Выполнено');
    return {
      date,
      jobs: dayJobs.length,
      profit: completed.reduce((sum, job) => sum + job.profit, 0)
    };
  });
  const maxProfit = Math.max(...rows.map(row => Math.abs(row.profit)), 1);
  const maxJobs = Math.max(...rows.map(row => row.jobs), 1);
  $('chart').innerHTML = rows.map(row => {
    const profitWidth = Math.max(3, Math.round(Math.abs(row.profit) / maxProfit * 100));
    const jobsWidth = Math.max(3, Math.round(row.jobs / maxJobs * 100));
    return `<div class="chart-row">
      <span class="chart-label">${escapeHtml(formatDate(row.date).slice(0, 5))}</span>
      <div class="chart-bars">
        <div class="bar" style="width:${profitWidth}%"></div>
        <div class="bar jobs" style="width:${jobsWidth}%"></div>
      </div>
      <span class="chart-value">${money(row.profit)} · ${row.jobs}</span>
    </div>`;
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
  updateNotificationButton();
}

function updateNotificationButton() {
  if (!('Notification' in window)) {
    $('notificationButton').textContent = 'Напоминания не поддерживаются';
    $('notificationButton').disabled = true;
    return;
  }
  $('notificationButton').textContent = Notification.permission === 'granted'
    ? 'Напоминания разрешены'
    : 'Разрешить напоминания';
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
    job.id, job.date, normalizeStatus(job.status), job.name, job.phone, job.address,
    job.repairPrice, job.distanceKm, job.roundTripKm, job.fuelLiters,
    job.fuelCost, job.partsCost, job.totalCosts, job.profit, job.comment,
    job.updatedAt, job.scheduledDate || '', job.scheduledFrom || '', job.scheduledTo || '',
    job.reminderSentFor || ''
  ]];
}

function numberFromSheet(value) {
  return Math.max(0, Number(String(value ?? '').replace(',', '.')) || 0);
}

function jobFromSheet(row) {
  let phone = String(row[4] || '');
  const phoneWasFormula = phone.startsWith('=');
  if (phoneWasFormula) phone = phone.slice(1);
  const base = {
    id: String(row[0] || ''),
    date: String(row[1] || ''),
    status: normalizeStatus(String(row[2] || DEFAULT_STATUS)),
    name: String(row[3] || ''),
    phone,
    address: String(row[5] || ''),
    repairPrice: numberFromSheet(row[6]),
    distanceKm: numberFromSheet(row[7]),
    roundTripKm: numberFromSheet(row[8]),
    fuelLiters: numberFromSheet(row[9]),
    fuelCost: numberFromSheet(row[10]),
    partsCost: numberFromSheet(row[11]),
    totalCosts: numberFromSheet(row[12]),
    profit: Number(String(row[13] ?? '').replace(',', '.')) || 0,
    comment: String(row[14] || ''),
    updatedAt: String(row[15] || ''),
    scheduledDate: String(row[16] || ''),
    scheduledFrom: String(row[17] || ''),
    scheduledTo: String(row[18] || ''),
    reminderSentFor: String(row[19] || ''),
    synced: true
  };
  return { ...base, ...calculations(base), synced: true, needsPhoneRepair: phoneWasFormula };
}

async function loadJobsFromSheet(showMessage = true) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
  await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A1:T1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: [SHEET_HEADERS] })
  });
  const response = await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A2:T`)}?valueRenderOption=FORMULA&dateTimeRenderOption=FORMATTED_STRING`);
  const cloudJobs = (response.values || []).filter(row => row[0]).map(jobFromSheet);
  const merged = new Map(jobs.map(job => [String(job.id), normalizeJob(job)]));
  cloudJobs.forEach(cloudJob => {
    const localJob = merged.get(String(cloudJob.id));
    if (!localJob || !localJob.updatedAt || (cloudJob.updatedAt && cloudJob.updatedAt >= localJob.updatedAt)) {
      merged.set(String(cloudJob.id), {
        ...cloudJob,
        photoData: localJob?.photoData || '',
        photoName: localJob?.photoName || '',
        photoUpdatedAt: localJob?.photoUpdatedAt || ''
      });
    }
  });
  jobs = [...merged.values()].map(normalizeJob);
  saveJobs();
  const brokenPhones = jobs.filter(job => job.needsPhoneRepair);
  for (const job of brokenPhones) {
    delete job.needsPhoneRepair;
    await syncJob(job.id, { quiet: true });
  }
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
      await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:T${rowNumber}`)}?valueInputOption=RAW`, {
        method: 'PUT', body: JSON.stringify({ values: sheetRow(job) })
      });
    } else {
      await sheetsRequest(`${base}/${encodeURIComponent(`${SHEET_NAME}!A:T`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
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

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать фото'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось открыть фото'));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const img = await imageFromFile(file);
  const canvas = document.createElement('canvas');
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length > 900000 && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return { dataUrl };
}

function getStartDate(job) {
  if (!job.scheduledDate || !job.scheduledFrom) return null;
  const date = new Date(`${job.scheduledDate}T${job.scheduledFrom}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReminderKey(job) {
  return job.scheduledDate && job.scheduledFrom ? `${job.id}:${job.scheduledDate}:${job.scheduledFrom}` : '';
}

async function showRepairNotification(job) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const title = `Ремонт через 2 часа: ${job.name || 'клиент'}`;
  const body = `${formatSchedule(job)}${job.address ? ` · ${job.address}` : ''}`;
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    if (registration?.showNotification) {
      await registration.showNotification(title, { body, icon: './icon.svg', tag: getReminderKey(job) });
      return true;
    }
  }
  new Notification(title, { body, icon: './icon.svg', tag: getReminderKey(job) });
  return true;
}

async function checkReminders() {
  const now = new Date();
  let changed = false;
  for (const job of jobs) {
    if (['Выполнено', 'Отказ'].includes(job.status)) continue;
    const start = getStartDate(job);
    const key = getReminderKey(job);
    if (!start || !key || job.reminderSentFor === key) continue;
    const remindAt = new Date(start.getTime() - 2 * 60 * 60 * 1000);
    if (now >= remindAt && now < start) {
      const shown = await showRepairNotification(job);
      if (shown) {
        job.reminderSentFor = key;
        job.synced = false;
        changed = true;
      }
    }
  }
  if (changed) {
    saveJobs();
    if (accessToken && connectedEmail === ALLOWED_EMAIL) syncPendingJobs();
  }
}

$('newJobButton').addEventListener('click', () => openNewJob());
$('settingsButton').addEventListener('click', () => settingsDialog.showModal());
$('statusFilter').addEventListener('change', render);
$('searchInput').addEventListener('input', render);
$('chartRange').addEventListener('change', renderChart);
['repairPrice','partsCost','distanceKm'].forEach(id => $(id).addEventListener('input', updateCalculations));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => jobDialog.close()));
document.querySelectorAll('.close-settings').forEach(button => button.addEventListener('click', () => settingsDialog.close()));
document.querySelectorAll('.close-period').forEach(button => button.addEventListener('click', () => periodDialog.close()));
document.querySelectorAll('.period-option').forEach(button => button.addEventListener('click', () => setProfitPeriod(button.dataset.period)));

$('date').addEventListener('change', () => {
  if (!$('jobId').value && !$('scheduledDate').dataset.changed) $('scheduledDate').value = $('date').value;
});
$('scheduledDate').addEventListener('input', () => {
  $('scheduledDate').dataset.changed = 'true';
});

jobForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const job = await formJob();
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
    checkReminders();
  } catch (error) {
    toast(error.message || 'Не удалось сохранить заявку');
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

$('notificationButton').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  const permission = await Notification.requestPermission();
  updateNotificationButton();
  toast(permission === 'granted' ? 'Напоминания включены' : 'Напоминания не разрешены');
});

$('jobsList').addEventListener('click', event => {
  const card = event.target.closest('.job-card');
  if (!card) return;
  const job = jobs.find(item => item.id === card.dataset.id);
  if (event.target.closest('.edit')) editJob(card.dataset.id);
  if (event.target.closest('.sync')) syncJob(card.dataset.id);
  if (event.target.closest('.photo-open')) {
    if (!job?.photoData) toast('Фото для этой заявки нет');
    else {
      const win = window.open();
      if (win) win.document.write(`<title>Фото заявки</title><img src="${job.photoData}" style="max-width:100%;height:auto">`);
    }
  }
});

updateAccountStatus();
render();
const shared = parseSharedData();
if (shared) openNewJob(shared);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
setInterval(checkReminders, 60 * 1000);
checkReminders();
