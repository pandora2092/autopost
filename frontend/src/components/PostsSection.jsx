import { useState, useRef } from 'react';
import { postsApi, uploadApi } from '../api';

export default function PostsSection({ posts, profiles, onSave, onCancel, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [mediaPath, setMediaPath] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10);
    return d.toISOString().slice(0, 16);
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
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
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

  return (
    <section className="card">
      <h2>Запланированные публикации</h2>
      <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить пост</button>
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
          <input type="text" placeholder="Подпись (опц.)" value={caption} onChange={(e) => setCaption(e.target.value)} />
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
            <span className={`status ${p.status}`}>{p.status}</span>
            {p.status === 'pending' && (
              <button type="button" className="btn small danger" onClick={() => handleCancel(p.id)}>Отменить</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
