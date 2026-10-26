import { useState } from 'react';
import { npr, num } from '../lib/format';

/** Grouped vertical bars, e.g. expected vs collected per round. Values in paisa. */
export function GroupedBarChart({
  data, series, height = 220, xLabel,
}: {
  data: { label: string; values: number[]; note?: string }[];
  series: { name: string; color: string }[];
  height?: number;
  xLabel?: (l: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const W = Math.max(320, data.length * 64);
  const H = height;
  const pad = { l: 8, r: 8, t: 16, b: 28 };
  const innerH = H - pad.t - pad.b;
  const groupW = (W - pad.l - pad.r) / data.length;
  const barW = Math.min(22, (groupW - 12) / series.length);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[320px]" role="img">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + innerH * (1 - f)} y2={pad.t + innerH * (1 - f)} stroke="#e7e5e4" strokeDasharray="3 3" />
          ))}
          {data.map((d, i) => {
            const gx = pad.l + i * groupW + (groupW - barW * series.length) / 2;
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
                <rect x={pad.l + i * groupW} y={pad.t} width={groupW} height={innerH} fill={hover === i ? '#f5f5f4' : 'transparent'} />
                {d.values.map((v, j) => {
                  const h = (v / max) * innerH;
                  return <rect key={j} x={gx + j * barW} y={pad.t + innerH - h} width={barW - 2} height={Math.max(0, h)} rx={3} fill={series[j].color} />;
                })}
                <text x={pad.l + i * groupW + groupW / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#57534e">{xLabel ? xLabel(d.label) : d.label}</text>
                {d.note && <text x={pad.l + i * groupW + groupW / 2} y={pad.t - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1f6f5c">{d.note}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && (
        <div className="mt-1 rounded-lg bg-stone-100 px-3 py-1.5 text-xs">
          <b>{xLabel ? xLabel(data[hover].label) : data[hover].label}</b>
          {series.map((s, j) => <span key={s.name} className="ml-3">{s.name}: {npr(data[hover].values[j])}</span>)}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with negative support (net positions) or plain positives (arrears). */
export function HBarChart({ data, colorPos = '#2a8a72', colorNeg = '#dc2626' }: { data: { label: string; value: number; sub?: string }[]; colorPos?: string; colorNeg?: string }) {
  if (!data.length) return null;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const hasNeg = data.some((d) => d.value < 0);
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = (Math.abs(d.value) / maxAbs) * (hasNeg ? 50 : 100);
        return (
          <div key={d.label} className="text-xs">
            <div className="mb-0.5 flex justify-between gap-2">
              <span className="truncate font-medium">{d.label}</span>
              <span className={`shrink-0 font-semibold ${d.value < 0 ? 'text-red-700' : 'text-stone-700'}`}>{npr(d.value)}</span>
            </div>
            <div className="relative h-3 rounded bg-stone-100">
              {hasNeg && <div className="absolute inset-y-0 left-1/2 w-px bg-stone-400" />}
              <div
                className="absolute inset-y-0 rounded"
                style={{
                  background: d.value < 0 ? colorNeg : colorPos,
                  width: `${pct}%`,
                  left: hasNeg ? (d.value < 0 ? `${50 - pct}%` : '50%') : 0,
                }}
              />
            </div>
            {d.sub && <div className="mt-0.5 text-[11px] text-stone-500">{d.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 36, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={label}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="#e7e5e4" strokeWidth="10" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={pct >= 1 ? '#059669' : pct >= 0.5 ? '#d97706' : '#dc2626'} strokeWidth="10"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform="rotate(-90 44 44)" />
        <text x="44" y="49" textAnchor="middle" fontSize="16" fontWeight="700" fill="#292524">{num(Math.round(pct * 100))}%</text>
      </svg>
      <div className="text-xs text-stone-600">{label}</div>
    </div>
  );
}
