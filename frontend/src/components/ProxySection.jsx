import { useState } from 'react';
import { proxyApi } from '../api';

export default function ProxySection({ proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, proxyId: null, proxyLabel: '' });

  const handleSave = async () => {
    if (!host || !port) {
      showToast('Заполните хост и порт', 'error');
      return;
    }
    try {
      await proxyApi.create({ type: 'socks5', host, port: +port, login: login || undefined, password: password || undefined });
      showToast('Прокси добавлен', 'success');
      setShowForm(false);
      setHost('');
      setPort('');
      setLogin('');
      setPassword('');
      onSave();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteClick = (p) => {
    setDeleteConfirmPopup({
      visible: true,
      proxyId: p.id,
      proxyLabel: `${p.type} ${p.host}:${p.port}`,
    });
  };

  const handleDeleteConfirm = async () => {
    const { proxyId } = deleteConfirmPopup;
    setDeleteConfirmPopup({ visible: false, proxyId: null, proxyLabel: '' });
    if (!proxyId) return;
    try {
      await proxyApi.delete(proxyId);
      showToast('Прокси удалён');
      onDelete();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmPopup({ visible: false, proxyId: null, proxyLabel: '' });
  };

  return (
    <section className="card">
      <h2>Прокси</h2>
      <div className="card-actions">
        <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить прокси</button>
      </div>
      <div className="list">
        {proxies.map((p) => (
          <div key={p.id} className="list-item">
            <span>{p.type} {p.host}:{p.port}</span>
            <span className="id">{p.id.slice(0, 8)}</span>
            <button type="button" className="btn small danger" onClick={() => handleDeleteClick(p)}>Удалить</button>
          </div>
        ))}
      </div>
      {showForm && (
        <div className="form">
          <input type="text" placeholder="Хост" value={host} onChange={(e) => setHost(e.target.value)} />
          <input type="number" placeholder="Порт" value={port} onChange={(e) => setPort(e.target.value)} />
          <input type="text" placeholder="Логин (опц.)" value={login} onChange={(e) => setLogin(e.target.value)} />
          <input type="password" placeholder="Пароль (опц.)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="btn" onClick={handleSave}>Сохранить</button>
          <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
        </div>
      )}

      {deleteConfirmPopup.visible && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-icon">⚠</div>
            <h3>Удалить прокси?</h3>
            <p className="modal-vm-name">{deleteConfirmPopup.proxyLabel}</p>
            <p className="delete-confirm-warning">
              Прокси будет удалён. VM, привязанные к нему, останутся без прокси.
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
