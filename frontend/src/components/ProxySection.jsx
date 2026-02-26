import { useState } from 'react';
import { proxyApi } from '../api';

export default function ProxySection({ proxies, onSave, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

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

  const handleDelete = async (id) => {
    if (!confirm('Удалить прокси?')) return;
    try {
      await proxyApi.delete(id);
      showToast('Удалено');
      onDelete();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <section className="card">
      <h2>Прокси</h2>
      <button type="button" className="btn primary" onClick={() => setShowForm(true)}>Добавить прокси</button>
      <div className="list">
        {proxies.map((p) => (
          <div key={p.id} className="list-item">
            <span>{p.type} {p.host}:{p.port}</span>
            <span className="id">{p.id.slice(0, 8)}</span>
            <button type="button" className="btn small danger" onClick={() => handleDelete(p.id)}>Удалить</button>
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
    </section>
  );
}
