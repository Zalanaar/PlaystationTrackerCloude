// П15.3: «Таблицей» под графиком — раскрывающаяся таблица с теми же цифрами. Нативные <details>/<summary>: клавиатура и
// экранные чтецы без своего кода; на телефоне таблица прокручивается вбок внутри блока, страница — нет.
import type { TableData } from './tableData';

export function ChartTable({ caption, data, testId }: { caption: string; data: TableData; testId?: string }) {
  if (data.rows.length === 0) return null;
  return (
    <details className="ps-ctab" data-testid={testId}>
      <summary className="ps-ctab__sum">Таблицей</summary>
      <div className="ps-ctab__wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className="ps-ctab__t ps-num">
          <caption className="ps-sr">{caption}</caption>
          <thead>
            <tr>{data.head.map((h, i) => <th key={h} scope="col" data-num={i > 0 || undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r[0]}>
                <th scope="row">{r[0]}</th>
                {r.slice(1).map((c, i) => <td key={i}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
