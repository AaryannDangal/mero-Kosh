/**
 * Money helpers. All amounts inside the system are integer paisa.
 * 1 NPR = 100 paisa.
 */

export function assertInt(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of paisa, got ${value}`);
  }
}

export function nprToPaisa(npr: number): number {
  if (!Number.isFinite(npr)) throw new RangeError('amount must be finite');
  return Math.round(npr * 100);
}

export function paisaToNpr(paisa: number): number {
  return paisa / 100;
}

/** Format paisa as "NPR 12,345.50" (Indian/Nepali digit grouping). */
export function formatNpr(paisa: number, currency = 'NPR'): string {
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  const s = String(rupees);
  // Nepali/Indian grouping: last 3 digits, then groups of 2
  let grouped: string;
  if (s.length <= 3) grouped = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${negative ? '-' : ''}${currency} ${grouped}${ps ? '.' + String(ps).padStart(2, '0') : ''}`;
}

/**
 * Split `total` paisa into `n` integer shares that sum exactly to `total`.
 * The first `total % n` shares receive one extra paisa.
 */
export function distributeEvenly(total: number, n: number): number[] {
  assertInt(total, 'total');
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  if (n === 0) {
    if (total !== 0) throw new RangeError('cannot distribute a non-zero amount among zero recipients');
    return [];
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const remainder = abs % n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/** distributeEvenly keyed by recipient id (order of ids decides who gets remainder paisa). */
export function distributeEvenlyFor(total: number, ids: string[]): { memberId: string; amount: number }[] {
  const parts = distributeEvenly(total, ids.length);
  return ids.map((memberId, i) => ({ memberId, amount: parts[i] }));
}
