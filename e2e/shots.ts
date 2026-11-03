// Куда писать скриншоты из e2e. PNG в git не коммитим (docs/qa/**/*.png в .gitignore, см. docs/qa/README.md):
// по умолчанию снимки уходят в test-results/shots/<sub> (в CI это артефакт), SHOTS_DIR переопределяет папку целиком.
export function shotsDir(sub: string): string {
  return process.env.SHOTS_DIR ?? `test-results/shots/${sub}`;
}
