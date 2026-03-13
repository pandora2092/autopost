import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { proxyApi, vmApi, profilesApi, postsApi, systemApi } from './api';
import ProxySection from './components/ProxySection';
import VmSection from './components/VmSection';
import ProfilesSection from './components/ProfilesSection';
import PostsSection from './components/PostsSection';
import QueueSection from './components/QueueSection';
import Toast from './components/Toast';
import './App.css';

const nav = [
  { id: 'proxy', path: '/proxy', label: 'Прокси' },
  { id: 'vm', path: '/vm', label: 'Виртуальные машины' },
  { id: 'profiles', path: '/profiles', label: 'Профили' },
  { id: 'posts', path: '/posts', label: 'Публикации' },
  { id: 'queue', path: '/queue', label: 'Очередь' },
];

function App() {
  const [toast, setToast] = useState({ text: '', type: '' });
  const [proxies, setProxies] = useState([]);
  const [vms, setVms] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [posts, setPosts] = useState([]);
  const [queue, setQueue] = useState({ pending: [], byStatus: [], recent: [] });
  const [stats, setStats] = useState({ vm: 0, profile: 0, posts: {} });

  const showToast = (text, type = '') => {
    setToast({ text, type });
    setTimeout(() => setToast({ text: '', type: '' }), 4000);
  };

  const loadProxies = async () => {
    try {
      const data = await proxyApi.list();
      setProxies(data);
    } catch (e) {
      showToast('Ошибка загрузки прокси: ' + e.message, 'error');
    }
  };

  const loadVms = async () => {
    try {
      const data = await vmApi.list();
      setVms(data);
    } catch (e) {
      showToast('Ошибка загрузки VM: ' + e.message, 'error');
    }
  };

  const loadProfiles = async () => {
    try {
      const data = await profilesApi.list();
      setProfiles(data);
    } catch (e) {
      showToast('Ошибка загрузки профилей: ' + e.message, 'error');
    }
  };

  const loadPosts = async () => {
    try {
      const data = await postsApi.list();
      setPosts(data);
    } catch (e) {
      showToast('Ошибка загрузки постов: ' + e.message, 'error');
    }
  };

  const loadQueue = async () => {
    try {
      const [q, s] = await Promise.all([systemApi.queue(), systemApi.stats()]);
      setQueue(q);
      setStats(s);
    } catch (e) {
      showToast('Ошибка загрузки очереди: ' + e.message, 'error');
    }
  };

  useEffect(() => {
    loadProxies();
    loadVms();
    loadProfiles();
    loadPosts();
    loadQueue();
  }, []);

  useEffect(() => {
    const t = setInterval(loadQueue, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <header>
        <h1>Панель автопостинга</h1>
        <nav>
          {nav.map(({ id, path, label }) => (
            <NavLink key={id} to={path} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/proxy" replace />} />
          <Route path="/proxy" element={<ProxySection proxies={proxies} onSave={loadProxies} onDelete={loadProxies} showToast={showToast} />} />
          <Route path="/vm" element={<VmSection vms={vms} proxies={proxies} onSave={loadVms} onDelete={() => { loadVms(); loadProfiles(); }} showToast={showToast} />} />
          <Route path="/profiles" element={<ProfilesSection profiles={profiles} vms={vms} onSave={loadProfiles} onDelete={() => { loadProfiles(); loadPosts(); }} showToast={showToast} />} />
          <Route path="/posts" element={<PostsSection posts={posts} profiles={profiles} onSave={() => { loadPosts(); loadQueue(); }} onCancel={() => { loadPosts(); loadQueue(); }} showToast={showToast} />} />
          <Route path="/queue" element={<QueueSection queue={queue} stats={stats} />} />
        </Routes>
      </main>
      <Toast text={toast.text} type={toast.type} />
    </>
  );
}

export default App;
