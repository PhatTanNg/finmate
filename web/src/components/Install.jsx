import React, { useEffect, useState } from 'react';
import { Card } from './ui.jsx';

/**
 * Cài FinMate vào màn hình chính.
 *
 * Android/Chrome bắn sự kiện `beforeinstallprompt` nên có thể cài bằng một nút.
 * iOS KHÔNG có API nào tương đương — người dùng bắt buộc phải tự bấm Chia sẻ →
 * "Thêm vào MH chính", và nếu không ai chỉ thì họ sẽ không bao giờ biết.
 *
 * Với iPhone việc này không chỉ là cho đẹp: Safari dọn dữ liệu website sau
 * khoảng 7 ngày không đụng tới. Sổ sách nằm trong bộ nhớ trình duyệt, nên mở
 * trong tab Safari mà bỏ quên hai tuần là có thể mất sạch. App đã cài vào màn
 * hình chính thì được miễn luật đó.
 */

/* Component này chạy cả trong jsdom (bộ test render 18 trang) lẫn trong lúc
   dựng sẵn HTML, nơi window/navigator có thể không đầy đủ. Mọi lần chạm vào
   API trình duyệt đều phải tự phòng, nếu không cả trang trắng. */
const win = typeof window !== 'undefined' ? window : null;
const nav = typeof navigator !== 'undefined' ? navigator : null;
const ua = () => (nav?.userAgent || '');

export const standalone = () => {
  try {
    if (win?.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  } catch { /* jsdom không có matchMedia */ }
  return nav?.standalone === true;
};

/** iPad đời mới khai user-agent là Macintosh, phải nhìn thêm số điểm chạm. */
export const isIOS = () => /iphone|ipad|ipod/i.test(ua())
  || (/macintosh/i.test(ua()) && (nav?.maxTouchPoints || 0) > 1);

const isSafari = () => /safari/i.test(ua()) && !/crios|fxios|edgios|opios/i.test(ua());

/** Bắt lời mời cài của Chrome/Edge để dành cho lúc người dùng bấm nút. */
function useInstallPrompt() {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    if (!win?.addEventListener) return undefined;
    const on = (e) => { e.preventDefault(); setEvt(e); };
    win.addEventListener('beforeinstallprompt', on);
    return () => win.removeEventListener('beforeinstallprompt', on);
  }, []);
  return [evt, setEvt];
}

/* Vẽ thẳng icon Chia sẻ của iOS. Ký tự SF Symbols (􀈂) chỉ hiện trên máy Apple,
   chỗ khác ra ô vuông trống trông như app hỏng. */
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
    style={{ verticalAlign: '-2px', margin: '0 1px' }}
    fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" />
    <path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7" />
  </svg>
);

const IosSteps = () => (
  <ol className="mini guide-steps">
    <li>Mở FinMate bằng <b>Safari</b>{!isSafari() && <> (trình duyệt bạn đang dùng không thêm được vào màn hình chính)</>}.</li>
    <li>Bấm nút <b>Chia sẻ</b> <ShareIcon /> ở thanh dưới — hình vuông có mũi tên đi lên.</li>
    <li>Vuốt xuống, chọn <b>Thêm vào MH chính</b> (Add to Home Screen).</li>
    <li>Bấm <b>Thêm</b>. FinMate hiện ra như một app thật, chạy toàn màn hình, mở được cả khi mất mạng.</li>
  </ol>
);

/** Thẻ đầy đủ trong Cài đặt. */
export function InstallCard() {
  const [evt, setEvt] = useInstallPrompt();
  const done = standalone();
  return (
    <Card title="📲 Cài FinMate vào màn hình chính">
      {done ? (
        <p className="mini">
          ✅ Bạn đang chạy FinMate như một app rồi — toàn màn hình, có icon riêng, và dữ liệu
          không bị trình duyệt dọn.
        </p>
      ) : (
        <>
          {isIOS() ? <IosSteps /> : (
            <>
              <p className="mini">Cài để chạy toàn màn hình, có icon riêng và mở được khi mất mạng.</p>
              {evt ? (
                <button
                  className="btn primary"
                  onClick={async () => { evt.prompt(); await evt.userChoice; setEvt(null); }}
                >Cài ngay</button>
              ) : (
                <p className="mini">
                  Mở menu của trình duyệt (⋮) rồi chọn <b>Cài ứng dụng</b> / <b>Thêm vào màn hình chính</b>.
                </p>
              )}
            </>
          )}
          {isIOS() && (
            <div className="note-warn mini" style={{ marginTop: 10 }}>
              ⚠️ Nên cài thật, đừng chỉ để trong tab: <b>Safari tự xoá dữ liệu website sau khoảng 7 ngày
              không mở</b>. Sổ sách của bạn nằm trong bộ nhớ trình duyệt nên có thể mất theo. App đã
              thêm vào màn hình chính thì không bị luật này. Dù sao vẫn nên thỉnh thoảng bấm
              <b> Sao lưu</b> và cất file ra ngoài.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Lời nhắc gọn ở trang chủ, ẩn được và nhớ là đã ẩn. */
export function InstallNudge({ onOpen }) {
  const [hid, setHid] = useState(() => {
    try { return localStorage.getItem('finmate.install.hidden') === '1'; } catch { return false; }
  });
  const [evt] = useInstallPrompt();
  if (hid || standalone()) return null;
  if (!isIOS() && !evt) return null;   // trình duyệt không cài được thì không làm phiền
  const hide = () => { setHid(true); try { localStorage.setItem('finmate.install.hidden', '1'); } catch { /* riêng tư */ } };
  return (
    <div className="note mini" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
      <span style={{ flex: 1 }}>
        📲 Thêm FinMate vào màn hình chính để dùng như app —{' '}
        {isIOS() ? 'và để Safari không dọn mất sổ của bạn.' : 'mở nhanh hơn, chạy được khi mất mạng.'}
      </span>
      <button className="btn sm" onClick={onOpen}>Cách cài</button>
      <button className="btn sm ghost" aria-label="Ẩn lời nhắc" onClick={hide}>✕</button>
    </div>
  );
}
