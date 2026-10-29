'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '../collection/api';
import { formatDate, formatNumber } from '../format';
import { Sheet } from '../primitives/Sheet';
import { postRestore } from './api';
import {
  changeLine, changesText, parseBackupFile, restoreErrorText, SECTION_LABEL, SECTION_ORDER, totalChanges, type BackupRestoreData,
} from './model';
import './backup.css';

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; file: unknown; name: string; data: BackupRestoreData }
  | { kind: 'done'; data: BackupRestoreData };

function errText(e: unknown): string {
  return e instanceof ApiError ? restoreErrorText(e.status, e.code, e.reason) : restoreErrorText(0, 'network', undefined);
}

/** Восстановление разметки из файла: выбор, предпросмотр (ничего не пишется), подтверждение, применение (20.3). */
export function RestoreFileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Восстановить из файла" wide>
      {open && <Body onClose={onClose} />}
    </Sheet>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(f: File | undefined) {
    if (!f || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const parsed = parseBackupFile(await f.text(), f.size);
      if (!parsed.ok) { setErr(parsed.error); return; }
      const data = await postRestore('preview', parsed.value);
      setStep({ kind: 'preview', file: parsed.value, name: f.name, data });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function apply() {
    if (step.kind !== 'preview' || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const data = await postRestore('apply', step.file);
      setStep({ kind: 'done', data });
      router.refresh();
    } catch (e) {
      setErr(`Не восстановлено. ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'pick') {
    return (
      <div className="ps-stack ps-reset">
        <div className="ps-reset__text">
          <p>Выбери файл копии, скачанный из PS Tracker. Сначала покажу, что изменится, ничего не записывается без подтверждения.</p>
          <p>Восстановление только добавляет и обновляет данные из файла, ничего не удаляет.</p>
        </div>
        <input
          ref={input} type="file" accept="application/json,.json" className="ps-backup__file" aria-label="Файл копии"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {busy && <p className="ps-micro" role="status">Проверяю файл…</p>}
        {err && <p role="alert" className="ps-field-error">{err}</p>}
        <div className="ps-reset__btns">
          <button type="button" className="ps-btn" onClick={onClose}>Отмена</button>
          <button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={() => input.current?.click()}>Выбрать файл</button>
        </div>
      </div>
    );
  }

  const { data } = step;
  const total = totalChanges(data);
  const created = formatDate(data.fileCreatedAt);
  const rows = SECTION_ORDER.map((k) => ({ k, c: data.sections[k] })).filter(({ c }) => c.add + c.change + c.unchanged + c.skipped > 0);

  if (step.kind === 'done') {
    return (
      <div className="ps-stack ps-reset">
        <p role="status"><b>Готово.</b> {total > 0 ? `Применено: ${changesText(total)}.` : 'Все данные из файла уже были в трекере.'}</p>
        {data.backupId !== null && <p className="ps-backup__note">Прежние статусы сохранены в служебной копии (№ {data.backupId}), при необходимости их можно вернуть.</p>}
        {data.missing.length > 0 && <p className="ps-backup__note">Не найдено игр: {formatNumber(data.missing.length)}. Они пропущены.</p>}
        <div className="ps-reset__btns"><button type="button" className="ps-btn ps-btn--primary" onClick={onClose}>Закрыть</button></div>
      </div>
    );
  }

  return (
    <div className="ps-stack ps-reset">
      <div className="ps-reset__text">
        <p>Файл «{step.name}»{created ? `, создан ${created}` : ''}.</p>
        <p>{total > 0 ? <>Будет применено: <b className="num">{changesText(total)}</b>.</> : 'Менять нечего: всё из файла уже есть в трекере.'}</p>
      </div>
      <table className="ps-backup__table" aria-label="Что изменится по разделам">
        <thead><tr><th scope="col">Раздел</th><th scope="col">Новое</th><th scope="col">Изменится</th><th scope="col">Без изменений</th><th scope="col">Пропущено</th></tr></thead>
        <tbody>
          {rows.map(({ k, c }) => (
            <tr key={k}>
              <th scope="row">{SECTION_LABEL[k]}</th>
              <td className="num">{c.add}</td><td className="num">{c.change}</td><td className="num">{c.unchanged}</td><td className="num">{c.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.changes.length > 0 && (
        <details className="ps-backup__details">
          <summary>Список изменений ({data.changes.length}{data.changesTruncated ? '+' : ''})</summary>
          <ul className="ps-backup__list">
            {data.changes.map((c, i) => (
              <li key={`${c.section}-${c.titleId ?? c.name}-${i}`}>
                <span className="ps-backup__sec">{SECTION_LABEL[c.section]}</span>
                <b>{c.name}</b>
                <span className="num">{changeLine(c)}</span>
              </li>
            ))}
          </ul>
          {data.changesTruncated && <p className="ps-backup__note">Показаны первые {data.changes.length}, остальные будут применены тоже.</p>}
        </details>
      )}
      {data.missing.length > 0 && (
        <details className="ps-backup__details">
          <summary>Не найдено в трекере: {data.missing.length}</summary>
          <p className="ps-backup__note">Этих игр сейчас нет в коллекции, они будут пропущены.</p>
          <ul className="ps-backup__list">
            {data.missing.map((m) => <li key={m.titleId}><b>{m.name}</b><span className="num">{m.titleId}</span></li>)}
          </ul>
        </details>
      )}
      {err && <p role="alert" className="ps-field-error">{err}</p>}
      <div className="ps-reset__btns">
        <button type="button" className="ps-btn" onClick={() => { setErr(null); setStep({ kind: 'pick' }); }} disabled={busy}>Другой файл</button>
        <button type="button" className="ps-btn ps-btn--primary" disabled={busy || total === 0} onClick={() => void apply()}>
          {busy ? 'Восстанавливаю…' : 'Восстановить'}
        </button>
      </div>
    </div>
  );
}
