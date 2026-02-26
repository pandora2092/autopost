export default function Toast({ text, type }) {
  if (!text) return null;
  return (
    <div className={`toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`}>
      {text}
    </div>
  );
}
