// П8.3: картинка «Итоги года» 1080×1920 для сторис и Telegram (next/og, на сервере: обложки PSN без CORS в canvas не нарисовать).
// Только для вошедшего пользователя (маршрут /api/wrapped/share под сессией), без публичной ссылки и кэша.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { fetchCoverDataUrl, SHARE_H, SHARE_W, type ShareModel } from './share';

const FONT_DIR = join(process.cwd(), 'src/server/wrapped/share-fonts');
type Font = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' };
let fontsP: Promise<Font[]> | null = null;
function fonts(): Promise<Font[]> {
  fontsP ??= Promise.all(([
    ['Unbounded', 'unbounded-latin-700-normal.woff', 700], ['Unbounded', 'unbounded-cyrillic-700-normal.woff', 700],
    ['Inter', 'inter-latin-400-normal.woff', 400], ['Inter', 'inter-cyrillic-400-normal.woff', 400],
    ['Inter', 'inter-latin-600-normal.woff', 600], ['Inter', 'inter-cyrillic-600-normal.woff', 600],
  ] as const).map(async ([name, file, weight]) => {
    const b = await readFile(join(FONT_DIR, file));
    return { name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight, style: 'normal' as const };
  }));
  return fontsP;
}

const FG = '#ffffff';
const DIM = 'rgba(255,255,255,0.72)';

function Ph({ title, size, radius }: { title: string; size: number; radius: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FG, fontFamily: 'Unbounded', fontSize: size * 0.36 }}>
      {(title.trim()[0] ?? '?').toUpperCase()}
    </div>
  );
}
function Img({ src, title, size, radius }: { src: string | null; title: string; size: number; radius: number }) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori: обычный img с data URL
  return src ? <img src={src} width={size} height={size} style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }} /> : <Ph title={title} size={size} radius={radius} />;
}

export async function renderShareImage(m: ShareModel, fetchImpl: typeof fetch = fetch): Promise<ImageResponse> {
  const [gotyImg, ...topImgs] = await Promise.all([fetchCoverDataUrl(m.goty?.cover ?? null, fetchImpl), ...m.top3.map((g) => fetchCoverDataUrl(g.cover, fetchImpl))]);
  const hoursLen = (m.hours ?? '').replace(/\s/g, '').length;
  const hoursSize = hoursLen <= 3 ? 300 : hoursLen <= 5 ? 240 : 190;
  return new ImageResponse(
    (
      <div style={{ width: SHARE_W, height: SHARE_H, display: 'flex', flexDirection: 'column', padding: '120px 88px 96px', color: FG, fontFamily: 'Inter', position: 'relative',
        background: 'linear-gradient(160deg, #3b2a8f 0%, #1a1450 38%, #0e0f16 75%)' }}>
        {gotyImg && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- фон: обложка игры года, приглушённая
          <img src={gotyImg} width={SHARE_W} height={SHARE_W} style={{ position: 'absolute', top: 0, left: 0, width: SHARE_W, height: SHARE_W, objectFit: 'cover', opacity: 0.3, maskImage: 'linear-gradient(180deg, #000 40%, transparent 100%)' }} />
        )}
        <div style={{ position: 'absolute', top: 0, left: 0, width: SHARE_W, height: SHARE_H, display: 'flex', background: 'linear-gradient(180deg, rgba(14,15,22,0.35) 0%, rgba(14,15,22,0.65) 45%, rgba(14,15,22,0.92) 100%)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30, letterSpacing: 4, color: DIM, fontWeight: 600 }}>
          <span>PS TRACKER · ИТОГИ {m.year}</span>
          {m.preliminary && <span style={{ padding: '10px 22px', borderRadius: 999, border: '2px solid rgba(255,255,255,0.45)', color: FG, letterSpacing: 1, fontSize: 26 }}>предварительно</span>}
        </div>
        {m.nick && <div style={{ display: 'flex', marginTop: 28, fontFamily: 'Unbounded', fontSize: 52 }}>{m.nick}</div>}
        {m.hours && (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 90 }}>
            <span style={{ fontFamily: 'Unbounded', fontSize: hoursSize, lineHeight: 1, letterSpacing: -8 }}>{m.hours}</span>
            <span style={{ fontSize: 44, color: DIM, marginTop: 18 }}>{m.hoursLabel}</span>
          </div>
        )}
        <div style={{ display: 'flex', marginTop: 72, gap: 40 }}>
          {m.stats.map((s) => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontFamily: 'Unbounded', fontSize: 84, lineHeight: 1 }}>{s.value}</span>
              <span style={{ fontSize: 32, color: DIM, marginTop: 12 }}>{s.label}</span>
            </div>
          ))}
        </div>
        {m.goty && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 'auto', padding: 36, borderRadius: 36, background: 'rgba(0,0,0,0.38)', border: '2px solid rgba(255,255,255,0.18)' }}>
            <Img src={gotyImg} title={m.goty.title} size={220} radius={20} />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 28, letterSpacing: 3, color: DIM, fontWeight: 600 }}>{m.goty.kicker.toUpperCase()}</span>
              <span style={{ fontFamily: 'Unbounded', fontSize: m.goty.title.length > 28 ? 40 : 52, marginTop: 14, lineHeight: 1.15 }}>{m.goty.title.length > 60 ? `${m.goty.title.slice(0, 58)}…` : m.goty.title}</span>
            </div>
          </div>
        )}
        {m.top3.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 44 }}>
            {m.top3.map((g, i) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                <span style={{ fontFamily: 'Unbounded', fontSize: 40, width: 44, color: DIM }}>{i + 1}</span>
                <Img src={topImgs[i] ?? null} title={g.title} size={88} radius={12} />
                <span style={{ flex: 1, fontSize: 38, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{g.title}</span>
                {g.hoursText && <span style={{ fontSize: 34, color: DIM }}>{g.hoursText}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    { width: SHARE_W, height: SHARE_H, fonts: await fonts(), headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="itogi-${m.year}.png"`, 'X-Robots-Tag': 'noindex' } },
  );
}
