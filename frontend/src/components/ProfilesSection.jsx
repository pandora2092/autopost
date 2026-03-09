import { useState } from 'react';
import { profilesApi } from '../api';

export default function ProfilesSection({ profiles, vms, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [vmId, setVmId] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, profileId: null, profileLabel: '' });

  const handleSave = async () => {
    if (!vmId) {
      showToast('Выберите VM', 'error');
      return;
    }
    try {
      await profilesApi.create({ vm_id: vmId, instagram_username: instagramUsername || undefined });
      showToast('Профиль создан', 'success');
      setShowForm(false);
      setVmId('');
      setInstagramUsername('');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleOpenStream = async (profileId) => {
    try {
      const r = await profilesApi.getStreamUrl(profileId);
      if (!r.ok) {
        showToast(r.instruction || 'Не удалось получить адрес', 'error');
        return;
      }
      const url = `/stream.html?adb=${encodeURIComponent(r.adb_address)}`;
      window.open(url, '_blank', 'width=800,height=600');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteClick = (p) => {
    setDeleteConfirmPopup({
      visible: true,
      profileId: p.id,
      profileLabel: `${p.vm_name}${p.instagram_username ? ` (@${p.instagram_username})` : ''}`,
    });
  };

  const handleDeleteConfirm = async () => {
    const { profileId } = deleteConfirmPopup;
    setDeleteConfirmPopup({ visible: false, profileId: null, profileLabel: '' });
    if (!profileId) return;
    try {
      await profilesApi.delete(profileId);
      showToast('Профиль удалён');
      onDelete();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmPopup({ visible: false, profileId: null, profileLabel: '' });
  };

  return (
    <section className="card">
      <h2>Профили (VM + Instagram)</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить профиль</button>
      </div>
      {showForm && (
        <div className="form">
          <select value={vmId} onChange={(e) => setVmId(e.target.value)} required>
            <option value="">— Выберите VM —</option>
            {vms.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <input type="text" placeholder="Логин Instagram (опц.)" value={instagramUsername} onChange={(e) => setInstagramUsername(e.target.value)} />
          <button type="button" className="btn" onClick={handleSave}>Сохранить</button>
          <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
        </div>
      )}
      <div className="list">
        {profiles.map((p) => (
          <div key={p.id} className="list-item">
            <span><strong>{p.vm_name}</strong></span>
            <span>{p.instagram_username || '—'}</span>
            <span className="status">{p.instagram_authorized ? 'авторизован' : 'нет'}</span>
            <button type="button" className="btn small" onClick={() => handleOpenStream(p.id)}>Открыть экран</button>
            <button type="button" className="btn small danger" onClick={() => handleDeleteClick(p)}>Удалить</button>
          </div>
        ))}
      </div>

      {deleteConfirmPopup.visible && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Удалить профиль?</h3>
            <p className="modal-vm-name">{deleteConfirmPopup.profileLabel}</p>
            <p className="delete-confirm-warning">
              Профиль и все связанные данные будут удалены. Это действие нельзя отменить.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleDeleteCancel}>Отмена</button>
              <button type="button" className="btn danger" onClick={handleDeleteConfirm}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
