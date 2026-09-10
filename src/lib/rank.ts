// Reddit's ranking formulas.
export const EPOCH = 1_700_000_000; // 2023-11-14, keeps hot values small

export function hot(up: number, down: number, createdAt: number): number {
  const s = up - down;
  const order = Math.log10(Math.max(Math.abs(s), 1));
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
  const seconds = createdAt - EPOCH;
  return Math.round((sign * order + seconds / 45000) * 1e7) / 1e7;
}

export function controversy(up: number, down: number): number {
  if (down <= 0 || up <= 0) return 0;
  const magnitude = up + down;
  const balance = up > down ? down / up : up / down;
  return Math.round(Math.pow(magnitude, balance) * 1e4) / 1e4;
}

/** Wilson lower bound, used for comment ordering ("best"). */
export function confidence(up: number, down: number): number {
  const n = up + down;
  if (n === 0) return 0;
  const z = 1.281551565545; // 80%
  const p = up / n;
  const left = p + (1 / (2 * n)) * z * z;
  const right = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const under = 1 + (1 / n) * z * z;
  return (left - right) / under;
}
