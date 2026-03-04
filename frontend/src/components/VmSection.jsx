import { useState } from 'react';
import { vmApi } from '../api';

export default function VmSection({ vms, proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [proxyId, setProxyId] = useState('');

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

  const handleGetIp = async (id) => {
    try {
      const r = await vmApi.getIp(id, true);
      if (!r.ip) {
        showToast('IP не получен. Запустите VM и подождите загрузки сети.', 'error');
        onSave();
        return;
      }
      await vmApi.setAndroidId(id);
      showToast(`IP и Android ID установлены: ${r.adb_address}`, 'success');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
      onSave();
    }
  };

  const handleInstallInstagram = async (id) => {
    try {
      await vmApi.installInstagram(id);
      showToast('Instagram установлен для VM', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить VM? Данные будут потеряны.')) return;
    try {
      await vmApi.delete(id);
      showToast('VM удалена');
      onDelete();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <section className="card">
      <h2>Виртуальные машины</h2>
      <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Создать VM</button>
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
            <button type="button" className="btn small" onClick={() => handleGetIp(v.id)} title="Узнать IP VM и сохранить как ADB (нужно запустить VM)">
              Узнать IP
            </button>
            <button type="button" className="btn small" onClick={() => handleStart(v.id)}>Старт</button>
            <button type="button" className="btn small" onClick={() => handleStop(v.id)}>Стоп</button>
            <button type="button" className="btn small" onClick={() => handleInstallInstagram(v.id)}>Установить Instagram</button>
            <button type="button" className="btn small danger" onClick={() => handleDelete(v.id)}>Удалить</button>
          </div>
        ))}
      </div>
    </section>
  );
}
