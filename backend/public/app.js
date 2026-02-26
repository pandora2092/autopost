const API = '/api';

async function request(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) throw new Error(data?.error || data || res.statusText);
  return data;
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// --- Proxy
async function loadProxies() {
  const list = document.getElementById('proxy-list');
  const select = document.querySelector('#vm-form select[name="proxy_id"]');
  const data = await request('/proxy');
  list.innerHTML = data.map((p) => `
    <div class="list-item">
      <span>${p.type} ${p.host}:${p.port}</span>
      <span class="id">${p.id.slice(0, 8)}</span>
      <button class="btn small danger" data-delete-proxy="${p.id}">Удалить</button>
    </div>
  `).join('');
  const opts = '<option value="">— Прокси (опц.) —</option>' + data.map((p) => `<option value="${p.id}">${p.type} ${p.host}:${p.port}</option>`).join('');
  if (select) select.innerHTML = opts;
  list.querySelectorAll('[data-delete-proxy]').forEach((b) => {
    b.onclick = () => deleteProxy(b.dataset.deleteProxy);
  });
}

function showProxyForm(show) {
  const form = document.getElementById('proxy-form');
  form.classList.toggle('hidden', !show);
  if (show) form.querySelectorAll('input').forEach((i) => { i.value = ''; });
}

async function saveProxy() {
  const form = document.getElementById('proxy-form');
  const host = form.querySelector('[name="host"]').value.trim();
  const port = form.querySelector('[name="port"]').value;
  const login = form.querySelector('[name="login"]').value.trim();
  const password = form.querySelector('[name="password"]').value;
  if (!host || !port) { toast('Заполните хост и порт', 'error'); return; }
  await request('/proxy', { method: 'POST', body: JSON.stringify({ type: 'socks5', host, port: +port, login: login || undefined, password: password || undefined }) });
  toast('Прокси добавлен', 'success');
  showProxyForm(false);
  loadProxies();
}

async function deleteProxy(id) {
  if (!confirm('Удалить прокси?')) return;
  await request('/proxy/' + id, { method: 'DELETE' });
  toast('Удалено');
  loadProxies();
}

// --- VM
async function loadVm() {
  const list = document.getElementById('vm-list');
  const data = await request('/vm');
  list.innerHTML = data.map((v) => `
    <div class="list-item">
      <span><strong>${v.name}</strong></span>
      <span class="status ${v.status}">${v.status}</span>
      <span class="id">MAC: ${v.mac || '—'}</span>
      ${v.adb_address ? `<span>ADB: ${v.adb_address}</span>` : ''}
      <button class="btn small" data-start-vm="${v.id}">Старт</button>
      <button class="btn small" data-stop-vm="${v.id}">Стоп</button>
      <button class="btn small" data-android-id="${v.id}">Set Android ID</button>
      <button class="btn small danger" data-delete-vm="${v.id}">Удалить</button>
    </div>
  `);
  list.querySelectorAll('[data-start-vm]').forEach((b) => { b.onclick = () => startVm(b.dataset.startVm); });
  list.querySelectorAll('[data-stop-vm]').forEach((b) => { b.onclick = () => stopVm(b.dataset.stopVm); });
  list.querySelectorAll('[data-android-id]').forEach((b) => { b.onclick = () => setAndroidId(b.dataset.androidId); });
  list.querySelectorAll('[data-delete-vm]').forEach((b) => { b.onclick = () => deleteVm(b.dataset.deleteVm); });
  // profile form vm select
  const profileSelect = document.querySelector('#profile-form select[name="vm_id"]');
  if (profileSelect) {
    profileSelect.innerHTML = '<option value="">— Выберите VM —</option>' + data.map((v) => `<option value="${v.id}">${v.name}</option>`).join('');
  }
}

function showVmForm(show) {
  document.getElementById('vm-form').classList.toggle('hidden', !show);
  if (show) document.querySelector('#vm-form [name="name"]').value = '';
}

async function saveVm() {
  const form = document.getElementById('vm-form');
  const name = form.querySelector('[name="name"]').value.trim();
  const proxy_id = form.querySelector('[name="proxy_id"]').value || undefined;
  if (!name) { toast('Введите имя VM', 'error'); return; }
  try {
    await request('/vm', { method: 'POST', body: JSON.stringify({ name, proxy_id }) });
    toast('VM создаётся…', 'success');
    showVmForm(false);
    loadVm();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function startVm(id) {
  await request('/vm/' + id + '/start', { method: 'POST' });
  toast('VM запускается');
  loadVm();
}

async function stopVm(id) {
  await request('/vm/' + id + '/stop', { method: 'POST' });
  toast('VM останавливается');
  loadVm();
}

async function setAndroidId(id) {
  try {
    const r = await request('/vm/' + id + '/set-android-id', { method: 'POST', body: JSON.stringify({}) });
    toast('Android ID: ' + r.android_id, 'success');
    loadVm();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteVm(id) {
  if (!confirm('Удалить VM? Данные будут потеряны.')) return;
  await request('/vm/' + id, { method: 'DELETE' });
  toast('VM удалена');
  loadVm();
  loadProfiles();
}

// --- Profiles
async function loadProfiles() {
  const list = document.getElementById('profile-list');
  const postSelect = document.querySelector('#post-form select[name="profile_id"]');
  const data = await request('/profiles');
  list.innerHTML = data.map((p) => `
    <div class="list-item">
      <span><strong>${p.vm_name}</strong></span>
      <span>${p.instagram_username || '—'}</span>
      <span class="status">${p.instagram_authorized ? 'авторизован' : 'нет'}</span>
      <a class="btn small" href="#" data-stream="${p.id}">Открыть экран</a>
      <button class="btn small danger" data-delete-profile="${p.id}">Удалить</button>
    </div>
  `);
  list.querySelectorAll('[data-stream]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); openStream(a.dataset.stream); };
  });
  list.querySelectorAll('[data-delete-profile]').forEach((b) => {
    b.onclick = () => deleteProfile(b.dataset.deleteProfile);
  });
  if (postSelect) {
    postSelect.innerHTML = '<option value="">— Профиль —</option>' + data.map((p) => `<option value="${p.id}">${p.vm_name} (${p.instagram_username || '—'})</option>`).join('');
  }
}

function showProfileForm(show) {
  document.getElementById('profile-form').classList.toggle('hidden', !show);
}

async function saveProfile() {
  const form = document.getElementById('profile-form');
  const vm_id = form.querySelector('[name="vm_id"]').value;
  const instagram_username = form.querySelector('[name="instagram_username"]').value.trim();
  if (!vm_id) { toast('Выберите VM', 'error'); return; }
  await request('/profiles', { method: 'POST', body: JSON.stringify({ vm_id, instagram_username: instagram_username || undefined }) });
  toast('Профиль создан', 'success');
  showProfileForm(false);
  loadProfiles();
}

async function openStream(profileId) {
  const r = await request('/profiles/' + profileId + '/stream-url');
  if (!r.ok) {
    toast(r.instruction || 'Не удалось получить адрес', 'error');
    return;
  }
  const url = '/stream.html?adb=' + encodeURIComponent(r.adb_address);
  window.open(url, '_blank', 'width=800,height=600');
}

async function deleteProfile(id) {
  if (!confirm('Удалить профиль?')) return;
  await request('/profiles/' + id, { method: 'DELETE' });
  toast('Профиль удалён');
  loadProfiles();
  loadPosts();
}

// --- Posts
async function loadPosts() {
  const list = document.getElementById('post-list');
  const data = await request('/posts');
  list.innerHTML = data.map((p) => `
    <div class="list-item">
      <span><strong>${p.instagram_username || p.profile_id}</strong></span>
      <span>${p.media_path}</span>
      <span>${new Date(p.scheduled_at).toLocaleString()}</span>
      <span class="status ${p.status}">${p.status}</span>
      ${p.status === 'pending' ? `<button class="btn small danger" data-cancel-post="${p.id}">Отменить</button>` : ''}
    </div>
  `);
  list.querySelectorAll('[data-cancel-post]').forEach((b) => {
    b.onclick = () => cancelPost(b.dataset.cancelPost);
  });
}

function showPostForm(show) {
  const form = document.getElementById('post-form');
  form.classList.toggle('hidden', !show);
  if (show) {
    const at = new Date();
    at.setMinutes(at.getMinutes() + 10);
    form.querySelector('[name="scheduled_at"]').value = at.toISOString().slice(0, 16);
  }
}

async function savePost() {
  const form = document.getElementById('post-form');
  const profile_id = form.querySelector('[name="profile_id"]').value;
  const media_path = form.querySelector('[name="media_path"]').value.trim();
  const caption = form.querySelector('[name="caption"]').value.trim();
  const scheduled_at = form.querySelector('[name="scheduled_at"]').value;
  if (!profile_id || !media_path) { toast('Выберите профиль и укажите путь к медиа', 'error'); return; }
  await request('/posts', {
    method: 'POST',
    body: JSON.stringify({ profile_id, media_path, caption: caption || undefined, scheduled_at: scheduled_at ? new Date(scheduled_at).toISOString() : undefined }),
  });
  toast('Пост добавлен в очередь', 'success');
  showPostForm(false);
  loadPosts();
  loadQueue();
}

async function cancelPost(id) {
  await request('/posts/' + id, { method: 'DELETE' });
  toast('Публикация отменена');
  loadPosts();
  loadQueue();
}

// --- Queue
async function loadQueue() {
  const data = await request('/system/queue');
  const stats = await request('/system/stats');
  document.getElementById('queue-stats').innerHTML = `
    <span>VM: ${stats.vm}</span>
    <span>Профили: ${stats.profile}</span>
    <span>Посты: ${JSON.stringify(stats.posts)}</span>
  `;
  document.getElementById('queue-pending').innerHTML = data.pending.length
    ? data.pending.map((p) => `
        <div class="list-item">
          <span>${p.instagram_username || p.profile_id}</span>
          <span>${new Date(p.scheduled_at).toLocaleString()}</span>
          <span class="status ${p.status}">${p.status}</span>
        </div>
      `).join('')
    : '<p class="muted">Нет постов в очереди</p>';
  document.getElementById('queue-recent').innerHTML = data.recent.length
    ? '<h3>Недавно опубликовано</h3>' + data.recent.map((p) => `
        <div class="list-item">
          <span>${p.instagram_username}</span>
          <span>${p.published_at ? new Date(p.published_at).toLocaleString() : ''}</span>
        </div>
      `).join('')
    : '';
}

// --- Event delegation
document.body.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const action = a.dataset.action;
  if (action === 'add-proxy') showProxyForm(true);
  if (action === 'save-proxy') saveProxy();
  if (action === 'cancel-proxy') showProxyForm(false);
  if (action === 'add-vm') showVmForm(true);
  if (action === 'save-vm') saveVm();
  if (action === 'cancel-vm') showVmForm(false);
  if (action === 'add-profile') showProfileForm(true);
  if (action === 'save-profile') saveProfile();
  if (action === 'cancel-profile') showProfileForm(false);
  if (action === 'add-post') showPostForm(true);
  if (action === 'save-post') savePost();
  if (action === 'cancel-post') showPostForm(false);
});

// Init
(async () => {
  try {
    await loadProxies();
    await loadVm();
    await loadProfiles();
    await loadPosts();
    await loadQueue();
  } catch (e) {
    toast('Ошибка загрузки: ' + e.message, 'error');
  }
})();
setInterval(loadQueue, 30000);
