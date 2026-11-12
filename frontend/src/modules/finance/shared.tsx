import { Badge, StatusBadge } from '@/components/ui';
import { money } from '@/lib/format';
import { STATUS_LABEL, type TxnKind, type TxnListItem } from './types';

export function Amount({ value, currency, kind, reversal }: { value: string | number; currency: string; kind: TxnKind; reversal?: boolean }) {
  const negative = (kind === 'expense') !== !!reversal;
  return (
    <span className={`font-medium tabular-nums ${negative ? 'text-slate-900 dark:text-slate-100' : 'text-emerald-700 dark:text-emerald-400'}`}>
      {negative ? '−' : '+'}{money(value, currency)}
    </span>
  );
}

export function TxnStatus({ t }: { t: Pick<TxnListItem, 'status' | 'current_step' | 'required_steps'> }) {
  if (t.status === 'submitted' && t.required_steps.length > 1) {
    return <StatusBadge status="submitted" label={`Step ${t.current_step + 1} of ${t.required_steps.length}`} />;
  }
  return <StatusBadge status={t.status} label={STATUS_LABEL[t.status]} />;
}

export function KindBadge({ kind, reversal }: { kind: TxnKind; reversal?: boolean }) {
  if (reversal) return <Badge tone="orange">Reversal</Badge>;
  return kind === 'income' ? <Badge tone="green">Income</Badge> : <Badge tone="blue">Expenditure</Badge>;
}
