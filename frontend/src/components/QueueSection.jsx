import { getPostStatusLabel } from '../api';

export default function QueueSection({ queue, stats }) {
  return (
    <section className="card">
      <h2>Очередь и статистика</h2>
      <div className="stats">
        <span>VM: {stats.vm}</span>
        <span>Профили: {stats.profile}</span>
        <span>Посты: {JSON.stringify(stats.posts || {})}</span>
      </div>
      <div className="list">
        {queue.pending?.length
          ? queue.pending.map((p) => (
              <div key={p.id} className="list-item">
                <span>{p.instagram_username || p.profile_id}</span>
                <span>{new Date(p.scheduled_at).toLocaleString()}</span>
                <span className={`status ${p.status}`}>{getPostStatusLabel(p.status)}</span>
              </div>
            ))
          : <p className="muted">Нет постов в очереди</p>}
      </div>
      {queue.recent?.length > 0 && (
        <>
          <h3>Недавно опубликовано</h3>
          <div className="list">
            {queue.recent.map((p) => (
              <div key={p.id} className="list-item">
                <span>{p.instagram_username}</span>
                <span>{p.published_at ? new Date(p.published_at).toLocaleString() : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
