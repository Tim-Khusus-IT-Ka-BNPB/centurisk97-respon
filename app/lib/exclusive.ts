// "Tidak ada" and "Tidak tahu" stand alone: ticking one clears the others, ticking another
// clears them. With no script the server refuses the mix instead.
export function settleExclusive(
  boxes: readonly HTMLInputElement[],
  changed: HTMLInputElement,
  exclusive: ReadonlySet<string>,
) {
  if (!changed.checked) return;
  const alone = exclusive.has(changed.value);
  for (const box of boxes) {
    if (box !== changed && (alone || exclusive.has(box.value))) box.checked = false;
  }
}
