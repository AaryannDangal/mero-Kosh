/**
 * A single bilingual table model rendered to JSON, CSV or PDF so every report
 * has identical content in every format.
 */
import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { formatNpr } from '../domain/money';

export type ColumnKind = 'text' | 'money' | 'number' | 'date' | 'datetime';

export interface Column {
  key: string;
  en: string;
  ne: string;
  kind?: ColumnKind;
}

export interface ReportTable {
  id: string;
  title: { en: string; ne: string };
  subtitle?: string;
  currency: string;
  columns: Column[];
  rows: Record<string, string | number | null | undefined>[];
  summary?: { en: string; ne: string; value: string | number | null; kind?: ColumnKind }[];
  warnings?: string[];
  generatedAt: string;
}

export function formatCell(v: unknown, kind: ColumnKind | undefined, currency: string): string {
  if (v === null || v === undefined || v === '') return '';
  switch (kind) {
    case 'money': return formatNpr(Number(v), currency);
    case 'date': return String(v).slice(0, 10);
    case 'datetime': return new Date(String(v)).toISOString().replace('T', ' ').slice(0, 16);
    default: return String(v);
  }
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with bilingual headers ("Member / सदस्य"). Money columns are exported as plain NPR numbers for spreadsheets. */
export function toCsv(t: ReportTable): string {
  const lines: string[] = [];
  lines.push(csvEscape(`${t.title.en} / ${t.title.ne}`));
  if (t.subtitle) lines.push(csvEscape(t.subtitle));
  lines.push(t.columns.map((c) => csvEscape(`${c.en} / ${c.ne}${c.kind === 'money' ? ` (${t.currency})` : ''}`)).join(','));
  for (const r of t.rows) {
    lines.push(
      t.columns
        .map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return '';
          if (c.kind === 'money') return (Number(v) / 100).toFixed(2);
          return csvEscape(formatCell(v, c.kind, t.currency));
        })
        .join(','),
    );
  }
  if (t.summary?.length) {
    lines.push('');
    for (const s of t.summary) {
      const val = s.kind === 'money' && s.value !== null ? (Number(s.value) / 100).toFixed(2) : String(s.value ?? '');
      lines.push(`${csvEscape(`${s.en} / ${s.ne}`)},${csvEscape(val)}`);
    }
  }
  for (const w of t.warnings ?? []) lines.push(csvEscape(`WARNING: ${w}`));
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 Nepali correctly
}

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
// Mukta (SIL OFL) covers both Latin and Devanagari, so mixed English/Nepali strings render in one run.
const FONT_REGULAR = path.join(FONT_DIR, 'Mukta-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'Mukta-Bold.ttf');

const GLYPH_FALLBACK: Record<string, string> = { 'Σ': 'Sum', '★': '*', '✓': 'OK', '⚠': '!' };
let fontCoverage: ((cp: number) => boolean) | null = null;
function coverage(): (cp: number) => boolean {
  if (!fontCoverage) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fontkit = require('fontkit');
      const f = fontkit.openSync(FONT_REGULAR);
      fontCoverage = (cp: number) => f.hasGlyphForCodePoint(cp);
    } catch {
      fontCoverage = () => true;
    }
  }
  return fontCoverage!;
}
/** Replace characters the embedded font cannot draw (avoids "tofu" boxes). */
export function pdfSafe(s: string): string {
  const has = coverage();
  return [...s].map((ch) => (has(ch.codePointAt(0)!) || ch === '\n' ? ch : GLYPH_FALLBACK[ch] ?? '?')).join('');
}

/** Render a landscape A4 PDF with English + Nepali headers. */
export function toPdf(t: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, info: { Title: t.title.en, Author: 'Mero Kosh' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const hasFont = fs.existsSync(FONT_REGULAR);
    const regular = hasFont ? FONT_REGULAR : 'Helvetica';
    const bold = hasFont && fs.existsSync(FONT_BOLD) ? FONT_BOLD : regular;

    doc.font(bold).fontSize(15).text(pdfSafe(t.title.en), { continued: false });
    if (hasFont) doc.font(bold).fontSize(12).text(pdfSafe(t.title.ne));
    doc.font(regular).fontSize(8.5).fillColor('#555').text(pdfSafe(`${t.subtitle ? t.subtitle + '  •  ' : ''}Generated ${t.generatedAt.replace('T', ' ').slice(0, 16)} UTC  •  Record-keeping only - this app never handles money`));
    doc.moveDown(0.6).fillColor('#000');

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weights = t.columns.map((c) => (c.kind === 'money' ? 1.15 : c.kind === 'date' || c.kind === 'datetime' ? 1 : c.kind === 'number' ? 0.6 : 1.3));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * pageWidth);
    const fontSize = t.columns.length > 10 ? 6.5 : t.columns.length > 7 ? 7.5 : 8.5;

    const drawHeader = () => {
      const y = doc.y;
      let x = doc.page.margins.left;
      const headerH = fontSize * 3.6;
      doc.rect(x, y, pageWidth, headerH).fill('#1f6f5c');
      doc.fillColor('#fff');
      t.columns.forEach((c, i) => {
        doc.font(bold).fontSize(fontSize).text(pdfSafe(c.en), x + 3, y + 2, { width: widths[i] - 6, lineBreak: true, height: headerH / 2 });
        if (hasFont) doc.font(regular).fontSize(fontSize - 0.5).text(c.ne, x + 3, y + headerH / 2, { width: widths[i] - 6, height: headerH / 2 });
        x += widths[i];
      });
      doc.fillColor('#000');
      doc.y = y + headerH + 2;
    };

    drawHeader();
    t.rows.forEach((r, idx) => {
      const cells = t.columns.map((c) => pdfSafe(formatCell(r[c.key], c.kind, t.currency)));
      doc.font(regular).fontSize(fontSize);
      const rowH = Math.max(...cells.map((s, i) => doc.heightOfString(s || ' ', { width: widths[i] - 6 }))) + 5;
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(doc.page.margins.left, y, pageWidth, rowH).fill('#f1f6f4').fillColor('#000');
      let x = doc.page.margins.left;
      cells.forEach((s, i) => {
        const kind = t.columns[i].kind;
        doc.fillColor(/OVERDUE|MISMATCH|DEFAULTED|REJECTED/.test(s) ? '#b91c1c' : /PARTIAL|PENDING|UNPAID/.test(s) ? '#a16207' : '#000');
        doc.text(s, x + 3, y + 2.5, { width: widths[i] - 6, align: kind === 'money' || kind === 'number' ? 'right' : 'left' });
        x += widths[i];
      });
      doc.fillColor('#000');
      doc.y = y + rowH;
    });
    if (!t.rows.length) doc.font(regular).fontSize(9).text('No records / कुनै रेकर्ड छैन', doc.page.margins.left, doc.y, { width: pageWidth, align: 'center' });

    const left = doc.page.margins.left;
    if (t.summary?.length) {
      doc.y += 10;
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.font(bold).fontSize(10).text('Summary / सारांश', left, doc.y, { width: pageWidth });
      // two-column summary grid: label (60%) + value (40%) per column
      const colW = pageWidth / 2;
      for (let i = 0; i < t.summary.length; i += 2) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
        const y = doc.y;
        let rowH = 0;
        t.summary.slice(i, i + 2).forEach((s, j) => {
          const x = left + j * colW;
          doc.font(regular).fontSize(8.5).fillColor('#444').text(pdfSafe(`${s.en} / ${s.ne}`), x, y, { width: colW * 0.6 - 6 });
          rowH = Math.max(rowH, doc.y - y);
          doc.font(bold).fillColor('#000').text(pdfSafe(formatCell(s.value, s.kind, t.currency)), x + colW * 0.6, y, { width: colW * 0.4 - 10 });
          rowH = Math.max(rowH, doc.y - y);
        });
        doc.y = y + rowH + 1;
      }
    }
    for (const w of t.warnings ?? []) {
      doc.y += 4;
      doc.font(bold).fontSize(9).fillColor('#b91c1c').text(pdfSafe(`Warning / चेतावनी: ${w}`), left, doc.y, { width: pageWidth }).fillColor('#000');
    }
    doc.end();
  });
}

export async function sendReport(res: Response, t: ReportTable, format: string) {
  const base = `${t.id}-${t.generatedAt.slice(0, 10)}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(t));
  }
  if (format === 'pdf') {
    const pdf = await toPdf(t);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.send(pdf);
  }
  return res.json(t);
}
