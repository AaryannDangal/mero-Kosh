/**
 * Single source of "now" so time can be controlled:
 *  - tests use vi.setSystemTime()
 *  - the seed script replays a realistic history with setClockOverride()
 */
let override: Date | null = null;

export function setClockOverride(d: Date | null): void {
  override = d ? new Date(d) : null;
}

export function now(): Date {
  return override ? new Date(override) : new Date();
}

/** Today's date as a UTC date-only value. */
export function today(): Date {
  const n = now();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
