const API = '/api';

export const POST_STATUS_LABELS = {
  pending: 'Ожидает',
  assigned: 'Назначен',
  publishing: 'Публикуется',
  published: 'Опубликован',
  simulated: 'Симуляция',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

export function getPostStatusLabel(status) {
  return POST_STATUS_LABELS[status] ?? status;
}

async function request(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!res.ok) {
    if (data && typeof data === 'object') {
      const msg = data.error || data.message || JSON.stringify(data);
      throw new Error(msg);
    }
    throw new Error(data || res.statusText);
  }
  if (res.status === 204) return null;
  return data;
}

export const proxyApi = {
  list: () => request('/proxy'),
  get: (id) => request(`/proxy/${id}`),
  create: (body) => request('/proxy', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/proxy/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/proxy/${id}`, { method: 'DELETE' }),
};

export const vmApi = {
  list: () => request('/vm'),
  get: (id) => request(`/vm/${id}`),
  create: (body) => request('/vm', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/vm/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/vm/${id}`, { method: 'DELETE' }),
  start: (id) => request(`/vm/${id}/start`, { method: 'POST' }),
  stop: (id) => request(`/vm/${id}/stop`, { method: 'POST' }),
  setAndroidId: (id) => request(`/vm/${id}/set-android-id`, { method: 'POST', body: JSON.stringify({}) }),
  getIp: (id, save = true) => request(`/vm/${id}/ip?save=${save ? '1' : '0'}`),
  installInstagram: (id) => request(`/vm/${id}/install-instagram`, { method: 'POST', body: JSON.stringify({}) }),
};

export const profilesApi = {
  list: () => request('/profiles'),
  get: (id) => request(`/profiles/${id}`),
  create: (body) => request('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/profiles/${id}`, { method: 'DELETE' }),
  getStreamUrl: (id) => request(`/profiles/${id}/stream-url`),
};

export const uploadApi = {
  upload: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API + '/upload', { method: 'POST', body: formData });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
    if (!res.ok) throw new Error(data?.message || data?.error || res.statusText);
    return data;
  },
};

export const postsApi = {
  list: (params) => {
    const q = new URLSearchParams(params).toString();
    return request('/posts' + (q ? '?' + q : ''));
  },
  get: (id) => request(`/posts/${id}`),
  create: (body) => request('/posts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  cancel: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  clearAll: () => request('/posts', { method: 'DELETE' }),
};

export const systemApi = {
  queue: () => request('/system/queue'),
  stats: () => request('/system/stats'),
};
