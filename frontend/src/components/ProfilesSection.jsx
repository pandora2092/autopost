import { useState, useMemo } from 'react';
import { profilesApi } from '../api';
import Pagination, { paginate, DEFAULT_PAGE_SIZE } from './Pagination';

function profileListNetworkSuffix(sn) {
  if (sn === 'youtube') return ' · YouTube';
  if (sn === 'vk') return ' · VK';
  return '';
}

function profileListNetworkLabel(sn) {
  if (sn === 'youtube') return 'YouTube';
  if (sn === 'vk') return 'VK';
  return 'Instagram';
}

export default function ProfilesSection({ profiles, vms, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const vmStatusById = useMemo(() => {
    const m = Object.create(null);
    for (const v of vms) m[v.id] = v.status;
    return m;
  }, [vms]);
  const { pageItems, currentPage, totalPages, total } = useMemo(
    () => paginate(profiles, page, DEFAULT_PAGE_SIZE),
    [profiles, page]
  );
  const [vmId, setVmId] = useState('');
  const [socialNetwork, setSocialNetwork] = useState('instagram');
  const [instagramUsername, setInstagramUsername] = useState('');
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, profileId: null, profileLabel: '' });
  const [clearMediaConfirmPopup, setClearMediaConfirmPopup] = useState({
    visible: false,
    profileId: null,
    profileLabel: '',
  });
  const [clearMediaLoading, setClearMediaLoading] = useState(false);
  const [streamWarnPopup, setStreamWarnPopup] = useState({ visible: false, vmName: '' });

  const handleSave = async () => {
    if (!vmId) {
      showToast('Выберите VM', 'error');
      return;
    }
    try {
      await profilesApi.create({
        vm_id: vmId,
        social_network: socialNetwork,
        instagram_username: instagramUsername || undefined,
      });
      showToast('Профиль создан', 'success');
      setShowForm(false);
      setVmId('');
      setSocialNetwork('instagram');
      setInstagramUsername('');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const effectiveVmStatus = (p) => {
    if (!p?.vm_id) return p?.vm_status;
    const fromVms = vmStatusById[p.vm_id];
    return fromVms !== undefined && fromVms !== null ? fromVms : p.vm_status;
  };

  const handleOpenStream = async (profileId) => {
    const p = profiles.find((x) => x.id === profileId);
    const st = effectiveVmStatus(p);
    if (p && st && st !== 'running') {
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
      profileLabel: `${p.vm_name}${p.instagram_username ? ` (@${p.instagram_username})` : ''}${profileListNetworkSuffix(p.social_network)}`,
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

  const handleClearMediaClick = (p) => {
    const st = effectiveVmStatus(p);
    if (st && st !== 'running') {
      setStreamWarnPopup({ visible: true, vmName: p.vm_name || '' });
      return;
    }
    setClearMediaConfirmPopup({
      visible: true,
      profileId: p.id,
      profileLabel: `${p.vm_name}${p.instagram_username ? ` (@${p.instagram_username})` : ''}${profileListNetworkSuffix(p.social_network)}`,
    });
  };

  const handleClearMediaCancel = () => {
    setClearMediaConfirmPopup({ visible: false, profileId: null, profileLabel: '' });
  };

  const handleClearMediaConfirm = async () => {
    const { profileId } = clearMediaConfirmPopup;
    setClearMediaConfirmPopup({ visible: false, profileId: null, profileLabel: '' });
    if (!profileId) return;
    setClearMediaLoading(true);
    try {
      const r = await profilesApi.clearMedia(profileId);
      showToast(r.remote_dir ? `Медиа очищено (${r.remote_dir})` : 'Медиа очищено', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setClearMediaLoading(false);
    }
  };

  return (
    <section className="card">
      <h2>Профили (VM + соцсеть)</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить профиль</button>
      </div>
      {showForm && (
        <div className="post-form card-inner">
          <p style={{ marginBottom: '0.75rem', color: 'var(--muted, #565f89)', fontSize: '0.9rem' }}>
            Для одной VM можно добавить отдельные профили Instagram, YouTube и VK. Нельзя создать два профиля одной и той же соцсети на ту же VM.
          </p>
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
            <label className="post-form-label">Соцсеть</label>
            <select
              value={socialNetwork}
              onChange={(e) => setSocialNetwork(e.target.value)}
              className="post-form-input-wide"
            >
              <option value="instagram">Instagram (Reels)</option>
              <option value="youtube">YouTube (Shorts)</option>
              <option value="vk">VK</option>
            </select>
          </div>
          <div className="post-form-row">
            <label className="post-form-label">
              {socialNetwork === 'youtube'
                ? 'Канал / @handle (опц.)'
                : socialNetwork === 'vk'
                  ? 'Короткое имя / id VK (опц.)'
                  : 'Логин Instagram (опц.)'}
            </label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder={
                socialNetwork === 'youtube'
                  ? 'Например mychannel'
                  : socialNetwork === 'vk'
                    ? 'Например id123456 или screen_name'
                    : 'Логин Instagram (опц.)'
              }
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
            <span>
              {profileListNetworkLabel(p.social_network)}
              {p.instagram_username ? ` · @${p.instagram_username}` : ''}
            </span>
            <span className={`status ${p.instagram_authorized ? 'authorized' : 'not-authorized'}`}>
              {p.instagram_authorized ? 'авторизован' : 'не авторизован'}
            </span>
            <button type="button" className="btn small" onClick={() => handleOpenStream(p.id)}>Открыть экран</button>
            <button
              type="button"
              className="btn small"
              disabled={clearMediaLoading}
              onClick={() => handleClearMediaClick(p)}
            >
              Очистить медиа
            </button>
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

      {clearMediaConfirmPopup.visible && (
        <div className="modal-overlay" onClick={handleClearMediaCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Очистить медиа на устройстве?</h3>
            <p className="modal-vm-name">{clearMediaConfirmPopup.profileLabel}</p>
            <p className="delete-confirm-warning">
              Будут удалены файлы в папке загрузок на Android (по умолчанию /sdcard/Download), откуда берутся ролики для публикации.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleClearMediaCancel} disabled={clearMediaLoading}>
                Отмена
              </button>
              <button type="button" className="btn danger" onClick={handleClearMediaConfirm} disabled={clearMediaLoading}>
                {clearMediaLoading ? 'Очистка…' : 'Очистить'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              Запустите VM в разделе «Виртуальные машины», затем повторите действие.
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
