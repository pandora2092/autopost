import { getPostStatusLabel } from '../api';

export default function QueueSection({ queue, stats }) {
  const posts = stats.posts || {};
  const postEntries = Object.entries(posts).filter(([status, n]) => n > 0 && status !== 'simulated');

  return (
    <section className="card">
      <h2>Очередь и статистика</h2>
      <div className="stats-grid">
        <div className="stats-item">
          <span className="stats-value">{stats.vm}</span>
          <span className="stats-label">VM</span>
        </div>
        <div className="stats-item">
          <span className="stats-value">{stats.profile}</span>
          <span className="stats-label">Профили</span>
        </div>
        <div className="stats-posts">
          <span className="stats-label">Посты</span>
          <div className="stats-post-badges">
            {postEntries.length > 0 ? (
              postEntries.map(([status, count]) => (
                <span key={status} className={`stats-badge status-${status}`} title={getPostStatusLabel(status)}>
                  {getPostStatusLabel(status)}: {count}
                </span>
              ))
            ) : (
              <span className="stats-muted">0</span>
            )}
          </div>
        </div>
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
