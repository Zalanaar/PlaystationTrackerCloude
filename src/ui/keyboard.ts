/** Высота экранной клавиатуры по visualViewport (design-system §10.4); 0 = клавиатуры нет */
export function keyboardHeight(innerHeight: number, vv: { height: number; offsetTop: number } | null): number {
  if (!vv || vv.height >= innerHeight - 120) return 0;
  return Math.max(0, innerHeight - vv.height - vv.offsetTop);
}
