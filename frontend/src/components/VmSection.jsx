import { useState } from 'react';
import { vmApi } from '../api';

export default function VmSection({ vms, proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [proxyId, setProxyId] = useState('');
  const [editingAdb, setEditingAdb] = useState(null);
  const [adbValue, setAdbValue] = useState('');

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
      showToast('VM останавливается');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleGetIp = async (id) => {
    try {
      const r = await vmApi.getIp(id, true);
      if (r.ip) {
        showToast(`IP: ${r.ip}, ADB сохранён: ${r.adb_address}`, 'success');
      } else {
        showToast('IP не получен. Запустите VM и подождите загрузки сети.', 'error');
      }
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleSetAndroidId = async (id) => {
    try {
      const r = await vmApi.setAndroidId(id);
      showToast('Android ID: ' + r.android_id, 'success');
      onSave();
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

  const handleSetAdb = async (id) => {
    const val = (editingAdb === id ? adbValue : '').trim();
    if (!val) {
      setEditingAdb(null);
      setAdbValue('');
      return;
    }
    try {
      await vmApi.update(id, { adb_address: val });
      showToast('ADB-адрес сохранён', 'success');
      setEditingAdb(null);
      setAdbValue('');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const startEditAdb = (vm) => {
    setEditingAdb(vm.id);
    setAdbValue(vm.adb_address || '');
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
            {editingAdb === v.id ? (
              <>
                <input
                  type="text"
                  placeholder="IP:5555"
                  value={adbValue}
                  onChange={(e) => setAdbValue(e.target.value)}
                  className="adb-input"
                />
                <button type="button" className="btn small" onClick={() => handleSetAdb(v.id)}>Сохранить ADB</button>
                <button type="button" className="btn small" onClick={() => { setEditingAdb(null); setAdbValue(''); }}>Отмена</button>
              </>
            ) : (
              <>
                {v.adb_address ? <span>ADB: {v.adb_address}</span> : null}
                <button type="button" className="btn small" onClick={() => handleGetIp(v.id)} title="Узнать IP VM и сохранить как ADB (нужно запустить VM)">
                  Узнать IP
                </button>
                <button type="button" className="btn small" onClick={() => startEditAdb(v)} title="Ввести ADB вручную">
                  {v.adb_address ? 'Изм. ADB' : 'Ввод ADB'}
                </button>
              </>
            )}
            <button type="button" className="btn small" onClick={() => handleStart(v.id)}>Старт</button>
            <button type="button" className="btn small" onClick={() => handleStop(v.id)}>Стоп</button>
            <button type="button" className="btn small" onClick={() => handleSetAndroidId(v.id)}>Set Android ID</button>
            <button type="button" className="btn small danger" onClick={() => handleDelete(v.id)}>Удалить</button>
          </div>
        ))}
      </div>
    </section>
  );
}
