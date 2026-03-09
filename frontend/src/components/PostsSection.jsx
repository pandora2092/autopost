import { useState, useRef } from 'react';
import { postsApi, uploadApi, getPostStatusLabel } from '../api';

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
  const [showForm, setShowForm] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [mediaPath, setMediaPath] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const [clearConfirmPopup, setClearConfirmPopup] = useState(false);
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
      const { deleted } = await postsApi.clearAll();
      showToast(`Удалено записей: ${deleted}`, 'success');
      onCancel();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleClearCancel = () => {
    setClearConfirmPopup(false);
  };

  return (
    <section className="card">
      <h2>Запланированные публикации</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить пост</button>
        <button type="button" className="btn danger" onClick={handleClearClick} disabled={posts.length === 0}>Очистить публикации</button>
      </div>
      {showForm && (
        <div className="form form-column">
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
            <option value="">— Профиль —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.vm_name} ({p.instagram_username || '—'})</option>
            ))}
          </select>
          <div className="form-upload">
            <label className="btn">
              {uploading ? 'Загрузка…' : 'Загрузить видео (MP4 / рилс)'}
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
          <input type="text" placeholder="Или путь к медиа на сервере" value={mediaPath} onChange={(e) => setMediaPath(e.target.value)} />
          <textarea placeholder="Подпись (опц.)" value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          <button type="button" className="btn" onClick={handleSave} disabled={uploading}>Добавить</button>
          <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
        </div>
      )}
      <div className="list">
        {posts.map((p) => (
          <div key={p.id} className="list-item">
            <span><strong>{p.instagram_username || p.profile_id}</strong></span>
            <span>{p.media_path}</span>
            <span>{new Date(p.scheduled_at).toLocaleString()}</span>
            <span className={`status ${p.status}`}>{getPostStatusLabel(p.status)}</span>
            {p.status === 'failed' && p.error_message && (
              <span className="error-message" title={p.error_message}>{p.error_message}</span>
            )}
            {p.status === 'pending' && (
              <button type="button" className="btn small danger" onClick={() => handleCancel(p.id)}>Отменить</button>
            )}
          </div>
        ))}
      </div>

      {clearConfirmPopup && (
        <div className="modal-overlay" onClick={handleClearCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Очистить публикации?</h3>
            <p className="delete-confirm-warning">
              Все записи будут удалены из базы данных. Это действие нельзя отменить.
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
