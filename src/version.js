export function compareVersions(a, b) {
  const left = String(a ?? '').split('.').map(part => Number.parseInt(part, 10));
  const right = String(b ?? '').split('.').map(part => Number.parseInt(part, 10));
  if (!left.length || !right.length || left.some(Number.isNaN) || right.some(Number.isNaN)) return 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

export const isNewerVersion = (candidate, current) => compareVersions(candidate, current) > 0;
