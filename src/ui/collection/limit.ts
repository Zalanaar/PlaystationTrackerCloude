// Параллельный запуск задач с ограничением одновременных запросов (массовое скрытие: PUT на каждую игру).

export type Settled<T, R> = { ok: { item: T; value: R }[]; failed: { item: T; error: unknown }[] };

/** Вызывает `fn` для каждого элемента, не больше `limit` одновременно. Ошибки не прерывают остальные. Порядок результатов = порядок входа. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<Settled<T, R>> {
  const results: ({ ok: true; value: R } | { ok: false; error: unknown })[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  const n = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  const out: Settled<T, R> = { ok: [], failed: [] };
  results.forEach((r, i) => {
    if (r.ok) out.ok.push({ item: items[i], value: r.value });
    else out.failed.push({ item: items[i], error: r.error });
  });
  return out;
}
