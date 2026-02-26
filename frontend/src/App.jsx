import { useState, useEffect } from 'react';
import { proxyApi, vmApi, profilesApi, postsApi, systemApi } from './api';
import ProxySection from './components/ProxySection';
import VmSection from './components/VmSection';
import ProfilesSection from './components/ProfilesSection';
import PostsSection from './components/PostsSection';
import QueueSection from './components/QueueSection';
import Toast from './components/Toast';
import './App.css';

function App() {
  const [section, setSection] = useState('proxy');
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

  const nav = [
    { id: 'proxy', label: 'Прокси' },
    { id: 'vm', label: 'Виртуальные машины' },
    { id: 'profiles', label: 'Профили' },
    { id: 'posts', label: 'Публикации' },
    { id: 'queue', label: 'Очередь' },
  ];

  return (
    <>
      <header>
        <h1>Панель автопостинга Instagram</h1>
        <nav>
          {nav.map(({ id, label }) => (
            <a key={id} href={'#' + id} onClick={(e) => { e.preventDefault(); setSection(id); }} className={section === id ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {section === 'proxy' && (
          <ProxySection proxies={proxies} onSave={loadProxies} onDelete={loadProxies} showToast={showToast} />
        )}
        {section === 'vm' && (
          <VmSection vms={vms} proxies={proxies} onSave={loadVms} onDelete={() => { loadVms(); loadProfiles(); }} showToast={showToast} />
        )}
        {section === 'profiles' && (
          <ProfilesSection profiles={profiles} vms={vms} onSave={loadProfiles} onDelete={() => { loadProfiles(); loadPosts(); }} showToast={showToast} />
        )}
        {section === 'posts' && (
          <PostsSection posts={posts} profiles={profiles} onSave={() => { loadPosts(); loadQueue(); }} onCancel={() => { loadPosts(); loadQueue(); }} showToast={showToast} />
        )}
        {section === 'queue' && <QueueSection queue={queue} stats={stats} />}
      </main>
      <Toast text={toast.text} type={toast.type} />
    </>
  );
}

export default App;
