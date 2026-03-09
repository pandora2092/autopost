import { useState } from 'react';
import { vmApi } from '../api';

export default function VmSection({ vms, proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [proxyId, setProxyId] = useState('');
  const [configuringVmId, setConfiguringVmId] = useState(null);
  const [configResultPopup, setConfigResultPopup] = useState({ visible: false, items: [], vmName: '' });
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, vmId: null, vmName: '' });
  const [proxyChangePopup, setProxyChangePopup] = useState({
    visible: false,
    vmId: null,
    vmName: '',
    newProxyId: null,
    newProxyLabel: '',
  });
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

  const handleStart = async (id) => {
    try {
      await vmApi.start(id);
      showToast('VM запускается');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
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
      ];
      if (vm?.proxy_id) {
        items.push('Загружена конфигурация прокси и запущен redsocks');
      }
      setConfigResultPopup({
        visible: true,
        items,
        vmName: vm?.name || 'VM',
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

  const handleInstallInstagram = async (id) => {
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
    setProxyChangePopup({ visible: false, vmId: null, vmName: '', newProxyId: null, newProxyLabel: '' });
    if (!vmId) return;
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
    }
  };

  const handleProxyChangeCancel = () => {
    setProxyChangePopup({ visible: false, vmId: null, vmName: '', newProxyId: null, newProxyLabel: '' });
  };

  return (
    <section className="card">
      <h2>Виртуальные машины</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Создать VM</button>
      </div>
      {showForm && (
        <div className="form">
          <input type="text" placeholder="Имя VM (латиница)" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value="">— Прокси (опц.) —</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>{p.type} {p.host}:{p.port}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={handleSave}>Создать</button>
          <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
        </div>
      )}
      <div className="list">
        {vms.map((v) => (
          <div key={v.id} className="list-item vm-row">
            <span><strong>{v.name}</strong></span>
            <span className={`status ${v.status}`}>{v.status}</span>
            <span className="id">MAC: {v.mac || '—'}</span>
            {v.adb_address ? <span>ADB: {v.adb_address}</span> : null}
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
            <button
              type="button"
              className="btn small"
              onClick={() => handleConfigureConfig(v.id)}
              title="Настроить конфигурацию: IP, ADB, прокси, Android ID (нужно запустить VM)"
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
            <button type="button" className="btn small" onClick={() => handleStart(v.id)}>Старт</button>
            <button type="button" className="btn small" onClick={() => handleStop(v.id)}>Стоп</button>
            <button
              type="button"
              className="btn small"
              onClick={() => handleInstallInstagram(v.id)}
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
        ))}
      </div>

      {configResultPopup.visible && (
        <div className="modal-overlay" onClick={() => setConfigResultPopup({ visible: false, items: [], vmName: '' })}>
          <div className="modal config-result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Конфигурация установлена</h3>
            <p className="modal-vm-name">{configResultPopup.vmName}</p>
            <ul className="config-result-list">
              {configResultPopup.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <button type="button" className="btn primary" onClick={() => setConfigResultPopup({ visible: false, items: [], vmName: '' })}>
              OK
            </button>
          </div>
        </div>
      )}

      {proxyChangePopup.visible && (
        <div className="modal-overlay" onClick={handleProxyChangeCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
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
