const NE = '०१२३४५६७८९';
export const toNeDigits = (s: string) => s.replace(/[0-9]/g, (d) => NE[Number(d)]);

let currentLang: 'en' | 'ne' = 'en';
export const setFormatLang = (l: 'en' | 'ne') => (currentLang = l);
const loc = (s: string) => (currentLang === 'ne' ? toNeDigits(s) : s);

/** paisa → "NPR 1,23,456.50" (Nepali/Indian grouping) */
export function npr(paisa: number | null | undefined, currency = 'NPR'): string {
  if (paisa === null || paisa === undefined || Number.isNaN(paisa)) return '—';
  const neg = paisa < 0;
  const abs = Math.abs(Math.round(paisa));
  const rupees = String(Math.floor(abs / 100));
  const ps = abs % 100;
  const grouped = rupees.length <= 3 ? rupees : `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${rupees.slice(-3)}`;
  const cur = currentLang === 'ne' && currency === 'NPR' ? 'रु.' : currency;
  return loc(`${neg ? '-' : ''}${cur} ${grouped}${ps ? '.' + String(ps).padStart(2, '0') : ''}`);
}

export const toPaisa = (v: string | number): number => Math.round(Number(String(v).replace(/[,\s]/g, '').replace(/[०-९]/g, (d) => String(NE.indexOf(d)))) * 100);
export const fromPaisa = (p: number | null | undefined) => (p == null ? '' : String(p / 100));

export function date(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return loc(new Date(d).toISOString().slice(0, 10));
}
export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d);
  return loc(x.toLocaleString(currentLang === 'ne' ? 'ne-NP' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }));
}
export const num = (n: number | string) => loc(String(n));
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** WhatsApp deep link (no paid SMS integration). */
export function whatsappLink(phone: string | null | undefined, text: string) {
  if (!phone) return null;
  let p = phone.replace(/[^\d]/g, '');
  if (p.length === 10 && p.startsWith('9')) p = '977' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
