import { useState, useMemo } from 'react';
import { profilesApi } from '../api';
import Pagination, { paginate, DEFAULT_PAGE_SIZE } from './Pagination';

export default function ProfilesSection({ profiles, vms, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const { pageItems, currentPage, totalPages, total } = useMemo(
    () => paginate(profiles, page, DEFAULT_PAGE_SIZE),
    [profiles, page]
  );
  const [vmId, setVmId] = useState('');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, profileId: null, profileLabel: '' });
  const [streamWarnPopup, setStreamWarnPopup] = useState({ visible: false, vmName: '' });

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
    const p = profiles.find((x) => x.id === profileId);
    if (p && p.vm_status && p.vm_status !== 'running') {
      setStreamWarnPopup({ visible: true, vmName: p.vm_name || '' });
      return;
    }
    try {
      const r = await profilesApi.getStreamUrl(profileId);
      if (!r.ok) {
        showToast(r.instruction || 'Не удалось получить адрес', 'error');
        return;
      }
      const url = r.stream_web_url || `/stream.html?adb=${encodeURIComponent(r.adb_address)}`;
      window.open(url, '_blank', 'width=900,height=700');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleStreamWarnClose = () => setStreamWarnPopup({ visible: false, vmName: '' });

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
        <div className="post-form card-inner">
          <div className="post-form-row">
            <label className="post-form-label">VM</label>
            <select
              value={vmId}
              onChange={(e) => setVmId(e.target.value)}
              className="post-form-input-wide"
            >
              <option value="">— Выберите VM —</option>
              {vms.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Логин Instagram</label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder="Логин Instagram (опц.)"
              value={instagramUsername}
              onChange={(e) => setInstagramUsername(e.target.value)}
            />
          </div>
          <div className="post-form-actions">
            <button type="button" className="btn primary" onClick={handleSave}>Добавить</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
          </div>
        </div>
      )}
      <div className="list">
        {pageItems.map((p) => (
          <div key={p.id} className="list-item">
            <span><strong>{p.vm_name}</strong></span>
            <span>{p.instagram_username || '—'}</span>
            <span className={`status ${p.instagram_authorized ? 'authorized' : 'not-authorized'}`}>
              {p.instagram_authorized ? 'авторизован' : 'не авторизован'}
            </span>
            <button type="button" className="btn small" onClick={() => handleOpenStream(p.id)}>Открыть экран</button>
            <button type="button" className="btn small danger" onClick={() => handleDeleteClick(p)}>Удалить</button>
          </div>
        ))}
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />

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

      {streamWarnPopup.visible && (
        <div className="modal-overlay" onClick={handleStreamWarnClose}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>VM должна быть запущена</h3>
            <p className="modal-vm-name">{streamWarnPopup.vmName || '—'}</p>
            <p className="delete-confirm-warning">
              Запустите VM в разделе «Виртуальные машины», затем снова нажмите «Открыть экран».
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleStreamWarnClose}>Понятно</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
