export const DEFAULT_PAGE_SIZE = 20;

export function paginate(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { pageItems, currentPage, totalPages, total, start };
}

export default function Pagination({ currentPage, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <span className="pagination-info">
        Страница {currentPage} из {totalPages} ({total} всего)
      </span>
      <div className="pagination-buttons">
        <button
          type="button"
          className="btn small"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ← Назад
        </button>
        <button
          type="button"
          className="btn small"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}
