import { useState, useMemo } from 'react';
import { proxyApi } from '../api';
import Pagination, { paginate, DEFAULT_PAGE_SIZE } from './Pagination';

export default function ProxySection({ proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const { pageItems, currentPage, totalPages, total } = useMemo(
    () => paginate(proxies, page, DEFAULT_PAGE_SIZE),
    [proxies, page]
  );
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [deleteConfirmPopup, setDeleteConfirmPopup] = useState({ visible: false, proxyId: null, proxyLabel: '' });

  const handleSave = async () => {
    if (!host?.trim() || !port) {
      showToast('Заполните хост и порт', 'error');
      return;
    }
    if (!login?.trim() || !password) {
      showToast('Заполните логин и пароль', 'error');
      return;
    }
    try {
      await proxyApi.create({ type: 'socks5', host: host.trim(), port: +port, login: login.trim(), password });
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
      {showForm && (
        <div className="post-form card-inner">
          <div className="post-form-row">
            <label className="post-form-label">Хост</label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder="Адрес прокси-сервера"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Порт</label>
            <input
              type="number"
              className="post-form-input-wide"
              placeholder="Порт"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Логин</label>
            <input
              type="text"
              className="post-form-input-wide"
              placeholder="Логин"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </div>
          <div className="post-form-row">
            <label className="post-form-label">Пароль</label>
            <input
              type="password"
              className="post-form-input-wide"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            <span>{p.type} {p.host}:{p.port}</span>
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
