/** Ошибка вызова массовой подгрузки HLTB с кодом HTTP; бросается fetchHltbRun (api.ts) и разбирается циклом (hltbRun.ts). */
export class HltbCallError extends Error {
  constructor(public status: number, public code: string, public reason?: string) {
    super(code);
  }
}
