import React, { useState } from 'react';
import { short, fmt, mdToHtml, vnDate } from '../lib/format.js';

export const Card = ({ title, children, right, className = '' }) => (
  <div className={`card ${className}`}>
    {(title || right) && (
      <div className="between" style={{ marginBottom: 12 }}>
        {title && <h3 style={{ margin: 0 }}>{title}</h3>}
        {right}
      </div>
    )}
    {children}
  </div>
);

export const Stat = ({ label, value, sub, tone }) => (
  <div className="card stat">
    <div className="lab">{label}</div>
    <div className={`val ${tone || ''}`}>{value}</div>
    {sub && <div className="sub">{sub}</div>}
  </div>
);

export const Progress = ({ value, tone }) => (
  <div className={`pbar ${tone || ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (Number(value) || 0) * 100))}%` }} /></div>
);

export const Md = ({ text }) => <div dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Loading = () => (
  <div className="loading"><div className="spin" /></div>
);

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between"><h2>{title}</h2><button className="btn sm ghost" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** Form động sinh từ mô tả field. */
export function Form({ fields, initial = {}, submit = 'Lưu', onSubmit, onCancel }) {
  const [v, setV] = useState(() => {
    const o = { ...initial };
    for (const f of fields) if (o[f.k] === undefined) o[f.k] = f.def ?? '';
    return o;
  });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <div className="fields">
        {fields.map((f) => (
          <div key={f.k} style={f.full ? { gridColumn: '1 / -1' } : undefined}>
            <label className="f">{f.label}</label>
            {f.type === 'select' ? (
              <select className="inp" value={v[f.k]} onChange={set(f.k)}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="inp" rows={3} value={v[f.k]} onChange={set(f.k)} placeholder={f.ph} />
            ) : (
              <input className="inp" type={f.type || 'text'} value={v[f.k]} onChange={set(f.k)} placeholder={f.ph} />
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Huỷ</button>}
        <button className="btn primary" type="submit">{submit}</button>
      </div>
    </form>
  );
}

// ---------- biểu đồ SVG tự vẽ (không cần thư viện) ----------

export function LineChart({ series = [], height = 170, color = '#5b8cff', fill = true, labels = [] }) {
  const data = series.map((n) => Number(n) || 0);
  if (data.length < 2) return <Empty>Chưa đủ dữ liệu</Empty>;
  const w = 600, h = height, pad = 8;
  const min = Math.min(...data, 0), max = Math.max(...data, 1);
  const x = (i) => pad + (i * (w - pad * 2)) / (data.length - 1);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2 - 14);
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const id = `g${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${x(data.length - 1)},${h - pad} L${x(0)},${h - pad} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => (i === data.length - 1 ? <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={color} /> : null))}
      {labels.length === data.length && labels.map((l, i) => (
        i % Math.ceil(data.length / 6) === 0 ? <text key={i} x={x(i)} y={h - 1} fontSize="10" fill="#6b7aa3" textAnchor="middle">{l}</text> : null
      ))}
    </svg>
  );
}

export function BarChart({ items = [], height = 190 }) {
  if (!items.length) return <Empty>Chưa có dữ liệu</Empty>;
  const max = Math.max(...items.map((i) => Math.max(Math.abs(i.a || 0), Math.abs(i.b || 0))), 1);
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 10, height, padding: '4px 0' }}>
        {items.map((it, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: height - 26 }}>
              <div title={`Thu ${fmt(it.a)}`} style={{ width: '42%', height: `${(Math.abs(it.a) / max) * 100}%`, background: 'linear-gradient(180deg,#2fd58a,#1c9c66)', borderRadius: '5px 5px 0 0', minHeight: 2 }} />
              <div title={`Chi ${fmt(it.b)}`} style={{ width: '42%', height: `${(Math.abs(it.b) / max) * 100}%`, background: 'linear-gradient(180deg,#ff8f8f,#d94a4a)', borderRadius: '5px 5px 0 0', minHeight: 2 }} />
            </div>
            <div className="mini" style={{ fontSize: 11, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden' }}>{it.label}</div>
          </div>
        ))}
      </div>
      <div className="row mini" style={{ gap: 14, justifyContent: 'center', marginTop: 4 }}>
        <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: '#2fd58a', marginRight: 5 }} />Thu</span>
        <span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: '#d94a4a', marginRight: 5 }} />Chi</span>
      </div>
    </div>
  );
}

const PALETTE = ['#5b8cff', '#7c5cff', '#2fd58a', '#ffc44d', '#ff6b6b', '#39c5ff', '#f472b6', '#a3e635', '#fb923c', '#94a3b8'];

export function Donut({ items = [], size = 168, unit = 'đ' }) {
  const total = items.reduce((s, i) => s + Math.abs(Number(i.value) || 0), 0);
  if (!total) return <Empty>Chưa có dữ liệu</Empty>;
  const r = 62, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="row wrap" style={{ gap: 18, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 160 160" style={{ flex: '0 0 auto' }}>
        <g transform="rotate(-90 80 80)">
          {items.map((it, i) => {
            const frac = Math.abs(it.value) / total;
            const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={it.color || PALETTE[i % PALETTE.length]} strokeWidth="19" strokeDasharray={`${frac * c} ${c}`} strokeDashoffset={-off * c} />;
            off += frac;
            return el;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="11" fill="#93a0c4">Tổng</text>
        <text x="80" y="94" textAnchor="middle" fontSize="17" fontWeight="700" fill="#e8ecf8">{unit === 'đ' ? short(total) : total}</text>
      </svg>
      <div style={{ flex: 1, minWidth: 150 }}>
        {items.slice(0, 9).map((it, i) => (
          <div key={i} className="between" style={{ padding: '3px 0', fontSize: 13 }}>
            <span className="row" style={{ gap: 7, minWidth: 0 }}>
              <i style={{ width: 9, height: 9, borderRadius: 3, background: it.color || PALETTE[i % PALETTE.length], flex: '0 0 auto' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            </span>
            <span className="mini" style={{ whiteSpace: 'nowrap' }}>{short(it.value)} · {Math.round((Math.abs(it.value) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Money = ({ v, sign }) => (
  <span className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>{sign && v > 0 ? '+' : ''}{fmt(v)}</span>
);

export const DateTxt = ({ v }) => <span className="mini">{vnDate(v)}</span>;
