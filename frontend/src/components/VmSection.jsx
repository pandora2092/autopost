import { useState, useMemo } from 'react';
import { vmApi, getVmStatusLabel } from '../api';
import Pagination, { paginate, DEFAULT_PAGE_SIZE } from './Pagination';

export default function VmSection({ vms, proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const { pageItems: vmsPage, currentPage, totalPages, total } = useMemo(
    () => paginate(vms, page, DEFAULT_PAGE_SIZE),
    [vms, page]
  );
  const [name, setName] = useState('');
  const [proxyId, setProxyId] = useState('');
  const [configuringVmId, setConfiguringVmId] = useState(null);
  const [configResultPopup, setConfigResultPopup] = useState({ visible: false, items: [], vmName: '', vmId: null });
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, vmId: null, vmName: '' });
  const [configureConfigPopup, setConfigureConfigPopup] = useState({ visible: false, vmId: null, vmName: '' });
  const [installInstagramPopup, setInstallInstagramPopup] = useState({ visible: false, vmId: null, vmName: '' });
  const [proxyChangePopup, setProxyChangePopup] = useState({
    visible: false,
    vmId: null,
    vmName: '',
    newProxyId: null,
    newProxyLabel: '',
  });
  const [applyingProxyVmId, setApplyingProxyVmId] = useState(null);
  const [startingVmId, setStartingVmId] = useState(null);
  const [firstStartConfirmPopup, setFirstStartConfirmPopup] = useState({ visible: false, vmId: null, vmName: '' });
  const [installingInstagramId, setInstallingInstagramId] = useState(null);

  const handleSave = async () => {
    if (!name?.trim()) {
      showToast('Введите имя VM', 'error');
      return;
    }
    try {
      await vmApi.create({ name: name.trim(), proxy_id: proxyId || undefined });
      showToast('VM создаётся…', 'success');
      setShowForm(false);
      setName('');
      setProxyId('');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleStartClick = (v) => {
    if (!v.adb_address) {
      setFirstStartConfirmPopup({ visible: true, vmId: v.id, vmName: v.name || 'VM' });
      return;
    }
    handleStart(v.id);
  };

  const handleFirstStartConfirm = () => {
    const { vmId } = firstStartConfirmPopup;
    setFirstStartConfirmPopup({ visible: false, vmId: null, vmName: '' });
    if (vmId) handleStart(vmId);
  };

  const handleFirstStartCancel = () => {
    setFirstStartConfirmPopup({ visible: false, vmId: null, vmName: '' });
  };

  const handleStart = async (id) => {
    setStartingVmId(id);
    try {
      const r = await vmApi.start(id);
      if (r.firstStart) {
        showToast('VM запускается. После загрузки нажмите «Настроить конфигурацию»');
      } else {
        showToast('VM запущена, прокси применён');
      }
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
      onSave();
    } finally {
      setStartingVmId(null);
    }
  };

  const handleStop = async (id) => {
    try {
      await vmApi.stop(id);
      showToast('VM остановлена');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleConfigureConfigClick = (v) => {
    if (v.status === 'running') {
      handleConfigureConfig(v.id);
    } else {
      setConfigureConfigPopup({ visible: true, vmId: v.id, vmName: v.name || 'VM' });
    }
  };

  const handleConfigureConfigConfirm = async () => {
    const { vmId } = configureConfigPopup;
    setConfigureConfigPopup({ visible: false, vmId: null, vmName: '' });
    if (!vmId) return;
    await handleConfigureConfig(vmId);
  };

  const handleConfigureConfigCancel = () => {
    setConfigureConfigPopup({ visible: false, vmId: null, vmName: '' });
  };

  const handleConfigureConfig = async (id) => {
    const vm = vms.find((v) => v.id === id);
    setConfiguringVmId(id);
    try {
      const r = await vmApi.getIp(id, true);
      if (!r.ip) {
        showToast('IP не получен. Запустите VM и подождите загрузки сети.', 'error');
        setConfiguringVmId(null);
        onSave();
        return;
      }
      await vmApi.setAndroidId(id);
      const items = [
        `Получен IP: ${r.ip}`,
        `Сохранён ADB-адрес: ${r.adb_address}`,
        'Установлен Android ID',
        'Установлен Build fingerprint',
        'Подменены ro.product.manufacturer и ro.product.model (Samsung, SM-G973F)',
      ];
      if (vm?.proxy_id) {
        items.push('Загружена конфигурация прокси и запущен redsocks');
      }
      setConfigResultPopup({
        visible: true,
        items,
        vmName: vm?.name || 'VM',
        vmId: id,
      });
      showToast('Конфигурация установлена', 'success');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
      onSave();
    } finally {
      setConfiguringVmId(null);
    }
  };

  const doInstallInstagram = async (id) => {
    setInstallingInstagramId(id);
    try {
      await vmApi.installInstagram(id);
      showToast('Instagram установлен для VM', 'success');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setInstallingInstagramId(null);
    }
  };

  const handleInstallInstagramClick = (v) => {
    if (v.status === 'running') {
      doInstallInstagram(v.id);
    } else {
      setInstallInstagramPopup({ visible: true, vmId: v.id, vmName: v.name || 'VM' });
    }
  };

  const handleInstallInstagramConfirm = async () => {
    const { vmId } = installInstagramPopup;
    setInstallInstagramPopup({ visible: false, vmId: null, vmName: '' });
    if (!vmId) return;
    await doInstallInstagram(vmId);
  };

  const handleInstallInstagramCancel = () => {
    setInstallInstagramPopup({ visible: false, vmId: null, vmName: '' });
  };

  const handleDeleteClick = (id) => {
    const vm = vms.find((v) => v.id === id);
    setDeleteConfirmPopup({ visible: true, vmId: id, vmName: vm?.name || 'VM' });
  };

  const handleDeleteConfirm = async () => {
    const { vmId } = deleteConfirmPopup;
    setDeleteConfirmPopup({ visible: false, vmId: null, vmName: '' });
    if (!vmId) return;
    try {
      await vmApi.delete(vmId);
      showToast('VM удалена');
      onDelete();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmPopup({ visible: false, vmId: null, vmName: '' });
  };

  const getProxySelectValue = (v) => {
    if (!v.proxy_id) return '';
    return proxies.some((p) => p.id === v.proxy_id) ? v.proxy_id : '';
  };

  const handleProxySelectChange = (vm, newProxyId) => {
    const currentValue = getProxySelectValue(vm);
    if ((newProxyId || '') === currentValue) return;
    const newProxy = newProxyId ? proxies.find((p) => p.id === newProxyId) : null;
    const newProxyLabel = newProxy ? `${newProxy.type} ${newProxy.host}:${newProxy.port}` : '';
    setProxyChangePopup({
      visible: true,
      vmId: vm.id,
      vmName: vm.name || 'VM',
      newProxyId: newProxyId || null,
      newProxyLabel,
    });
  };

  const handleProxyChangeConfirm = async () => {
    const { vmId, newProxyId } = proxyChangePopup;
    if (!vmId) return;
    setApplyingProxyVmId(vmId);
    try {
      await vmApi.update(vmId, { proxy_id: newProxyId || undefined });
      if (newProxyId) {
        await vmApi.applyProxy(vmId, true);
        showToast('Прокси обновлён и применён на устройстве');
      } else {
        showToast('Прокси убран');
      }
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setApplyingProxyVmId(null);
      setProxyChangePopup({ visible: false, vmId: null, vmName: '', newProxyId: null, newProxyLabel: '' });
    }
  };

  const handleProxyChangeCancel = () => {
    if (!applyingProxyVmId) {
      setProxyChangePopup({ visible: false, vmId: null, vmName: '', newProxyId: null, newProxyLabel: '' });
    }
  };

  const handleConfigResultOk = async () => {
    const { vmId } = configResultPopup;
    setConfigResultPopup({ visible: false, items: [], vmName: '', vmId: null });
    if (vmId) {
      try {
        await vmApi.stop(vmId);
        showToast('VM выключена');
      } catch (e) {
        showToast(e.message, 'error');
      }
      onSave();
    }
  };

  return (
    <section className="card">
      <h2>Виртуальные машины</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Создать VM</button>
      </div>
      {showForm && (
        <div className="post-form card-inner">
          <div className="post-form-row">
            <label className="post-form-label">Имя VM</label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder="Латиница без пробелов"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Прокси</label>
            <select
              value={proxyId}
              onChange={(e) => setProxyId(e.target.value)}
              className="post-form-input-wide"
            >
              <option value="">— Прокси (опц.) —</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>{p.type} {p.host}:{p.port}</option>
              ))}
            </select>
          </div>
          <div className="post-form-actions">
            <button type="button" className="btn primary" onClick={handleSave}>Создать</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
          </div>
        </div>
      )}
      <div className="vm-list">
        {vmsPage.map((v) => (
          <div key={v.id} className="vm-card">
            <div className="vm-card-header">
              <strong className="vm-card-name">{v.name}</strong>
              <span className={`status ${v.status}`}>{getVmStatusLabel(v.status)}</span>
            </div>
            <div className="vm-card-meta">
              <span className="vm-meta">MAC: {v.mac || '—'}</span>
              {v.adb_address && <span className="vm-meta">ADB: {v.adb_address}</span>}
            </div>
            <div className="vm-card-proxy">
              <label className="vm-proxy-label">Прокси</label>
              <select
                className="vm-proxy-select"
                value={getProxySelectValue(v)}
                onChange={(e) => handleProxySelectChange(v, e.target.value || null)}
                title="Прокси для VM"
              >
                <option value="">Выбрать прокси</option>
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>{p.type} {p.host}:{p.port}</option>
                ))}
              </select>
            </div>
            <div className="vm-card-actions">
              <div className="vm-actions-group">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => handleConfigureConfigClick(v)}
                  title="Настроить конфигурацию: IP, ADB, прокси, Android ID"
                  disabled={!!configuringVmId}
                >
                  {configuringVmId === v.id ? (
                    <>
                      <span className="loader-spinner" aria-hidden="true" />
                      Загрузка…
                    </>
                  ) : (
                    'Настроить конфигурацию'
                  )}
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => handleStartClick(v)}
                  disabled={!!startingVmId}
                >
                  {startingVmId === v.id ? (
                    <>
                      <span className="loader-spinner" aria-hidden="true" />
                      {v.proxy_id ? 'Загрузка, применение прокси…' : 'Загрузка…'}
                    </>
                  ) : (
                    'Старт'
                  )}
                </button>
                <button type="button" className="btn small" onClick={() => handleStop(v.id)}>Стоп</button>
              </div>
              <div className="vm-actions-group">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => handleInstallInstagramClick(v)}
                  disabled={!!v.instagram_installed || !!installingInstagramId}
                >
                  {installingInstagramId === v.id ? (
                    <>
                      <span className="loader-spinner" aria-hidden="true" />
                      Установка…
                    </>
                  ) : v.instagram_installed ? (
                    'Instagram установлен'
                  ) : (
                    'Установить Instagram'
                  )}
                </button>
                <button type="button" className="btn small danger" onClick={() => handleDeleteClick(v.id)}>Удалить</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
      />

      {configResultPopup.visible && (
        <div className="modal-overlay" onClick={() => handleConfigResultOk()}>
          <div className="modal config-result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Конфигурация установлена</h3>
            <p className="modal-vm-name">{configResultPopup.vmName}</p>
            <ul className="config-result-list">
              {configResultPopup.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <button type="button" className="btn primary" onClick={() => handleConfigResultOk()}>
              OK
            </button>
          </div>
        </div>
      )}

      {firstStartConfirmPopup.visible && (
        <div className="modal-overlay" onClick={handleFirstStartCancel}>
          <div className="modal delete-confirm-modal install-instagram-modal" onClick={(e) => e.stopPropagation()}>
            <div className="install-instagram-icon">ℹ</div>
            <h3>Первый запуск VM</h3>
            <p className="modal-vm-name">{firstStartConfirmPopup.vmName}</p>
            <p className="delete-confirm-warning">
              После загрузки системы нажмите «Настроить конфигурацию», чтобы установить IP, Android ID и при необходимости применить прокси (redsocks).
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleFirstStartCancel}>Отмена</button>
              <button type="button" className="btn primary" onClick={handleFirstStartConfirm}>Запустить</button>
            </div>
          </div>
        </div>
      )}

      {configureConfigPopup.visible && (
        <div className="modal-overlay" onClick={handleConfigureConfigCancel}>
          <div className="modal delete-confirm-modal install-instagram-modal" onClick={(e) => e.stopPropagation()}>
            <div className="install-instagram-icon">ℹ</div>
            <h3>Настроить конфигурацию</h3>
            <p className="modal-vm-name">{configureConfigPopup.vmName}</p>
            <p className="delete-confirm-warning">
              Для настройки конфигурации VM должна быть запущена. Запустите VM и нажмите «Настроить».
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleConfigureConfigCancel}>Отмена</button>
              <button type="button" className="btn primary" onClick={handleConfigureConfigConfirm}>Настроить</button>
            </div>
          </div>
        </div>
      )}

      {installInstagramPopup.visible && (
        <div className="modal-overlay" onClick={handleInstallInstagramCancel}>
          <div className="modal delete-confirm-modal install-instagram-modal" onClick={(e) => e.stopPropagation()}>
            <div className="install-instagram-icon">ℹ</div>
            <h3>Установить Instagram</h3>
            <p className="modal-vm-name">{installInstagramPopup.vmName}</p>
            <p className="delete-confirm-warning">
              Для установки Instagram VM должна быть запущена. Запустите VM и нажмите «Установить».
            </p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleInstallInstagramCancel}>Отмена</button>
              <button type="button" className="btn primary" onClick={handleInstallInstagramConfirm}>Установить</button>
            </div>
          </div>
        </div>
      )}

      {proxyChangePopup.visible && (
        <div className="modal-overlay" onClick={handleProxyChangeCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            {applyingProxyVmId === proxyChangePopup.vmId ? (
              <>
                <div className="proxy-apply-loading">
                  <span className="loader-spinner" aria-hidden="true" />
                  <p>Применяем прокси на устройство…</p>
                  <p className="modal-vm-name">{proxyChangePopup.vmName}</p>
                </div>
              </>
            ) : (
              <>
                <div className="delete-confirm-icon">⚠</div>
                <h3>Сменить прокси?</h3>
                <p className="modal-vm-name">{proxyChangePopup.vmName}</p>
                <p className="delete-confirm-warning">
                  {proxyChangePopup.newProxyLabel ? (
                    <>Будет установлен прокси: <strong>{proxyChangePopup.newProxyLabel}</strong>. Конфигурация будет загружена на устройство по ADB.</>
                  ) : (
                    <>Прокси будет убран. VM будет работать без прокси.</>
                  )}
                </p>
                <div className="modal-actions">
                  <button type="button" className="btn" onClick={handleProxyChangeCancel}>Отмена</button>
                  <button type="button" className="btn primary" onClick={handleProxyChangeConfirm}>Применить</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {deleteConfirmPopup.visible && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Удалить VM?</h3>
            <p className="modal-vm-name">{deleteConfirmPopup.vmName}</p>
            <p className="delete-confirm-warning">
              Все данные будут безвозвратно удалены. Это действие нельзя отменить.
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
