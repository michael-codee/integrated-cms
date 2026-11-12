/**
 * Chart building blocks (Recharts) following the CMIS data-viz rules:
 * validated categorical palette in fixed order, thin marks, recessive grid,
 * one axis, hover tooltips, legend for 2+ series, and a table view toggle.
 */
import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';
import { Card, CardHeader } from './ui';

// Validated (scripts/validate_palette.js) — light & dark steps of the same hues.
export const SERIES_LIGHT = ['#2a5bd7', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

export function seriesColor(i: number) {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (dark ? SERIES_DARK : SERIES_LIGHT)[i % 6];
}

const axis = { fontSize: 11, fill: 'currentColor' };
const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: '1px solid rgba(148,163,184,.4)', fontSize: 12, background: 'var(--tt-bg, #fff)', color: 'var(--tt-fg, #0f172a)' },
  cursor: { fill: 'rgba(148,163,184,.12)' },
};

export interface Series { key: string; label: string }

export function ChartCard({ title, subtitle, children, table, actions, height = 260 }: {
  title: string; subtitle?: ReactNode; children: ReactNode; table?: { columns: string[]; rows: (string | number)[][] }; actions?: ReactNode; height?: number;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} actions={<>
        {actions}
        {table && (
          <button onClick={() => setShowTable((s) => !s)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" title={showTable ? 'Show chart' : 'Show table'} aria-label={showTable ? 'Show chart' : 'Show table'}>
            {showTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
        )}
      </>} />
      <div className="p-4 text-slate-500 dark:text-slate-400" style={{ minHeight: height }}>
        {showTable && table ? (
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full text-sm text-slate-700 dark:text-slate-200">
              <thead><tr>{table.columns.map((c, i) => <th key={c} className={`px-2 py-1 text-xs font-semibold text-slate-500 ${i ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={`px-2 py-1 ${j ? 'text-right tabular-nums' : ''}`}>{typeof v === 'number' ? v.toLocaleString() : v}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </Card>
  );
}

export function TrendChart({ data, x, series, area = false, valueFormat }: { data: Record<string, unknown>[]; x: string; series: Series[]; area?: boolean; valueFormat?: (v: number) => string }) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={valueFormat} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => (valueFormat ? valueFormat(v) : v.toLocaleString())} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) =>
          area ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(i)} fill={seriesColor(i)} fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(i)} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

export function BarsChart({ data, x, series, horizontal = false, stacked = false, valueFormat }: { data: Record<string, unknown>[]; x: string; series: Series[]; horizontal?: boolean; stacked?: boolean; valueFormat?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} strokeOpacity={0.15} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={valueFormat} allowDecimals={false} />
            <YAxis type="category" dataKey={x} tick={axis} tickLine={false} axisLine={false} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? 'end' : 'middle'} height={data.length > 6 ? 60 : 30} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={valueFormat} allowDecimals={false} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={(v: number) => (valueFormat ? valueFormat(v) : v.toLocaleString())} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(i)} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36} stackId={stacked ? 'a' : undefined} stroke="var(--chart-surface, #fff)" strokeWidth={stacked ? 2 : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data }: { data: { label: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
        </Pie>
        <Tooltip {...tooltipStyle} formatter={(v: number) => `${v.toLocaleString()} (${total ? Math.round((v / total) * 100) : 0}%)`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(value, entry) => `${value} · ${((entry.payload as unknown as { count: number }).count || 0).toLocaleString()}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function monthLabel(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
