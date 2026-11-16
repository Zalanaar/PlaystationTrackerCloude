import { buildManifest, manifestTheme } from '@/shared/manifest';

// Манифест PWA (П11.5.2): цвета по ?theme= (ссылку ставит корневой layout по cookie темы). Публичный, без сессии (proxy его не трогает).
export function GET(req: Request) {
  const theme = manifestTheme(new URL(req.url).searchParams.get('theme'));
  return new Response(JSON.stringify(buildManifest(theme)), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' },
  });
}
