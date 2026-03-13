import { useState, useRef, useEffect, useMemo } from 'react';
import { postsApi, uploadApi, systemApi, getPostStatusLabel } from '../api';
import Pagination, { paginate, DEFAULT_PAGE_SIZE } from './Pagination';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTimeLocalValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateTimeLocalToISOString(value) {
  if (!value) return undefined;
  const [datePart, timePartRaw] = value.split('T');
  if (!datePart || !timePartRaw) return undefined;
  const [y, m, d] = datePart.split('-').map((x) => parseInt(x, 10));
  const [hh, mm, ss] = timePartRaw.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(hh) || !Number.isFinite(mm)) return undefined;
  const dt = new Date(y, m - 1, d, hh, mm, Number.isFinite(ss) ? ss : 0, 0);
  return dt.toISOString();
}

export default function PostsSection({ posts, profiles, onSave, onCancel, showToast }) {
  const [page, setPage] = useState(1);
  const { pageItems, currentPage, totalPages, total } = useMemo(
    () => paginate(posts, page, DEFAULT_PAGE_SIZE),
    [posts, page]
  );
  const [showForm, setShowForm] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [mediaPath, setMediaPath] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const [clearConfirmPopup, setClearConfirmPopup] = useState(false);
  const [retryPopup, setRetryPopup] = useState({ visible: false, post: null, newScheduledAt: '', newCaption: '' });
  const [diskSpace, setDiskSpace] = useState({ free: 0 });
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10);
    return formatDateTimeLocalValue(d);
  });

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp4')) {
      showToast('Выберите файл MP4 (рилс)', 'error');
      return;
    }
    setUploading(true);
    setSelectedFile(file.name);
    try {
      const { path: uploadedPath } = await uploadApi.upload(file);
      setMediaPath(uploadedPath);
      showToast('Файл загружен', 'success');
    } catch (err) {
      showToast(err.message || 'Ошибка загрузки', 'error');
      setSelectedFile(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!profileId || !mediaPath) {
      showToast('Выберите профиль и загрузите видео или укажите путь к медиа', 'error');
      return;
    }
    try {
      await postsApi.create({
        profile_id: profileId,
        media_path: mediaPath,
        caption: caption || undefined,
        scheduled_at: dateTimeLocalToISOString(scheduledAt),
      });
      showToast('Пост добавлен в очередь', 'success');
      setShowForm(false);
      setProfileId('');
      setMediaPath('');
      setCaption('');
      setSelectedFile(null);
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleCancel = async (id) => {
    try {
      await postsApi.cancel(id);
      showToast('Публикация отменена');
      onCancel();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleClearClick = () => {
    setClearConfirmPopup(true);
  };

  const handleClearConfirm = async () => {
    setClearConfirmPopup(false);
    try {
      const { deleted, filesDeleted } = await postsApi.clearAll();
      showToast(`Удалено записей: ${deleted}, медиа-файлов: ${filesDeleted}`, 'success');
      loadDiskSpace();
      onCancel();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleClearCancel = () => {
    setClearConfirmPopup(false);
  };

  const handleRetryClick = (p) => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    setRetryPopup({
      visible: true,
      post: p,
      newScheduledAt: formatDateTimeLocalValue(d),
      newCaption: p.caption || '',
    });
  };

  const handleRetryConfirm = async () => {
    const { post, newScheduledAt, newCaption } = retryPopup;
    setRetryPopup({ visible: false, post: null, newScheduledAt: '', newCaption: '' });
    if (!post) return;
    const scheduledAtIso = dateTimeLocalToISOString(newScheduledAt);
    if (!scheduledAtIso) {
      showToast('Укажите дату и время', 'error');
      return;
    }
    try {
      await postsApi.update(post.id, {
        status: 'pending',
        scheduled_at: scheduledAtIso,
        caption: newCaption || undefined,
      });
      showToast('Пост возвращён в очередь');
      onCancel();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleRetryCancel = () => {
    setRetryPopup({ visible: false, post: null, newScheduledAt: '', newCaption: '' });
  };

  const loadDiskSpace = async () => {
    try {
      const r = await systemApi.diskSpace();
      setDiskSpace(r);
    } catch (_) {}
  };

  useEffect(() => {
    loadDiskSpace();
  }, []);

  return (
    <section className="card">
      <h2>Запланированные публикации</h2>
      <div className="card-actions card-actions-with-meta">
        <div className="card-actions-buttons">
          <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить пост</button>
          <button type="button" className="btn danger" onClick={handleClearClick} disabled={posts.length === 0}>Очистить публикации</button>
        </div>
        <span className="disk-space">Свободно: {formatBytes(diskSpace.free)}</span>
      </div>
      {showForm && (
        <div className="post-form card-inner">
          <div className="post-form-row">
            <label className="post-form-label">Профиль</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
              <option value="">— Выберите профиль —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.vm_name} ({p.instagram_username || '—'})</option>
              ))}
            </select>
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Видео</label>
            <div className="form-upload">
              <label className="btn">
                {uploading ? 'Загрузка…' : 'Загрузить MP4'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,.mp4"
                  disabled={uploading}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
              {selectedFile && <span className="form-upload-name">{selectedFile}</span>}
            </div>
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Путь к медиа</label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder="Или путь к медиа на сервере (например uploads/video.mp4)"
              value={mediaPath}
              onChange={(e) => setMediaPath(e.target.value)}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Подпись</label>
            <textarea
              className="post-form-input-wide"
              placeholder="Подпись к посту (опц.)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Дата и время</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="post-form-actions">
            <button type="button" className="btn primary" onClick={handleSave} disabled={uploading}>Добавить</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
          </div>
        </div>
      )}
      <div className="post-list">
        {pageItems.map((p) => (
          <div key={p.id} className="post-card">
            <div className="post-card-header">
              <strong className="post-card-profile">{p.instagram_username || p.profile_id}</strong>
              <span className={`status ${p.status}`}>{getPostStatusLabel(p.status)}</span>
            </div>
            <div className="post-card-meta">
              <span className="post-meta-item">{p.media_path}</span>
              <span className="post-meta-date">{new Date(p.scheduled_at).toLocaleString()}</span>
            </div>
            {p.status === 'failed' && p.error_message && (
              <div className="post-card-error">
                {p.error_message}
              </div>
            )}
            {(p.status === 'pending' || p.status === 'failed') && (
              <div className="post-card-actions">
                {p.status === 'pending' && (
                  <button type="button" className="btn small danger" onClick={() => handleCancel(p.id)}>Отменить</button>
                )}
                {p.status === 'failed' && (
                  <button type="button" className="btn small primary" onClick={() => handleRetryClick(p)}>Повторить</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />

      {retryPopup.visible && retryPopup.post && (
        <div className="modal-overlay" onClick={handleRetryCancel}>
          <div className="modal retry-post-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Повторить публикацию</h3>
            <div className="retry-post-info">
              <div className="retry-post-row">
                <span className="retry-post-label">Профиль</span>
                <span>{retryPopup.post.vm_name} ({retryPopup.post.instagram_username || '—'})</span>
              </div>
              <div className="retry-post-row">
                <span className="retry-post-label">Медиа</span>
                <span className="retry-post-value">{retryPopup.post.media_path}</span>
              </div>
              <div className="post-form-row">
                <label className="post-form-label">Подпись</label>
                <textarea
                  className="post-form-input-wide"
                  placeholder="Подпись к посту (опц.)"
                  value={retryPopup.newCaption}
                  onChange={(e) => setRetryPopup((prev) => ({ ...prev, newCaption: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="retry-post-row">
                <span className="retry-post-label">Была дата</span>
                <span>{new Date(retryPopup.post.scheduled_at).toLocaleString()}</span>
              </div>
              {retryPopup.post.error_message && (
                <div className="retry-post-row retry-post-error">
                  <span className="retry-post-label">Ошибка</span>
                  <span className="error-message">{retryPopup.post.error_message}</span>
                </div>
              )}
            </div>
            <div className="post-form-row" style={{ marginBottom: '1rem' }}>
              <label className="post-form-label">Новая дата и время</label>
              <input
                type="datetime-local"
                value={retryPopup.newScheduledAt}
                onChange={(e) => setRetryPopup((prev) => ({ ...prev, newScheduledAt: e.target.value }))}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleRetryCancel}>Отмена</button>
              <button type="button" className="btn primary" onClick={handleRetryConfirm}>Повторить</button>
            </div>
          </div>
        </div>
      )}

      {clearConfirmPopup && (
        <div className="modal-overlay" onClick={handleClearCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Очистить публикации?</h3>
            <p className="delete-confirm-warning">
              Все записи будут удалены из базы данных, а папка uploads очищена от медиа-файлов (MP4). Это действие нельзя отменить.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleClearCancel}>Отмена</button>
              <button type="button" className="btn danger" onClick={handleClearConfirm}>Очистить</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
