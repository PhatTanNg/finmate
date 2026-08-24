import React, { useEffect, useMemo, useRef, useState } from 'react';

/** Bỏ dấu tiếng Việt để gõ "muc tieu" cũng tìm ra "Mục tiêu". */
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

/**
 * Bảng lệnh Ctrl/⌘+K — nhảy nhanh giữa các trang và chạy vài hành động.
 * `items`: [{ id, ico, label, group, run }]
 */
export default function CommandPalette({ items, onClose }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const hits = useMemo(() => {
    const f = fold(q).trim();
    if (!f) return items;
    return items.filter((it) => fold(`${it.label} ${it.group || ''} ${it.hint || ''}`).includes(f));
  }, [q, items]);

  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [i, hits]);

  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => (n + 1) % Math.max(hits.length, 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => (n - 1 + hits.length) % Math.max(hits.length, 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); pick(hits[i]); }
  }

  function pick(it) {
    if (!it) return;
    onClose();
    it.run();
  }

  return (
    <div className="cmdk-bg" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Bảng lệnh">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={key}
          placeholder="Đi tới trang, đổi chủ đề, ghi chi tiêu…"
          aria-label="Tìm lệnh"
        />
        <div className="cmdk-list" ref={listRef}>
          {hits.length === 0 && <div className="empty">Không có kết quả cho “{q}”</div>}
          {hits.map((it, n) => (
            <button
              key={it.id}
              className={`cmdk-item ${n === i ? 'on' : ''}`}
              onMouseEnter={() => setI(n)}
              onClick={() => pick(it)}
            >
              <span className="ico">{it.ico}</span>
              <span>{it.label}</span>
              {it.group && <span className="grp">{it.group}</span>}
            </button>
          ))}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> chọn</span>
          <span><kbd>Enter</kbd> mở</span>
          <span><kbd>Esc</kbd> đóng</span>
        </div>
      </div>
    </div>
  );
}
