import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setEngine } from './lib/api.js';
import './styles.css';

const root = createRoot(document.getElementById('root'));

if (import.meta.env.VITE_EMBEDDED === '1') {
  // Bản chạy ngay trên điện thoại: nạp SQLite WebAssembly + dữ liệu đã lưu rồi mới vẽ app.
  root.render(<div className="lock"><div className="lock-box"><div className="lock-logo">F</div><p className="muted">Đang mở sổ của bạn…</p></div></div>);
  Promise.all([import('./native/boot.js'), import('sql.js/dist/sql-wasm.wasm?url')])
    .then(([{ bootEmbedded }, wasm]) => bootEmbedded({ wasmUrl: wasm.default }))
    .then((engine) => { setEngine(engine); root.render(<App />); })
    .catch((e) => {
      console.error(e);
      root.render(<div className="lock"><div className="lock-box"><div className="lock-logo">!</div><h1>Không mở được</h1><p className="muted">{String(e?.message || e)}</p><button className="btn primary" onClick={() => location.reload()}>Thử lại</button></div></div>);
    });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
} else {
  root.render(<App />);
}
