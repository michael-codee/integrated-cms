import { labellable, Select } from './ui';
import { useOrgUnits, UNIT_LABELS } from '@/lib/queries';

/** Picks an org unit from the user's jurisdiction. `types` limits the choices. */
export const UnitSelect = labellable(function UnitSelect({ value, onChange, types, placeholder = 'All units', allowEmpty = true, invalid, className, id }: {
  value: string; onChange: (v: string) => void; types?: string[]; placeholder?: string; allowEmpty?: boolean; invalid?: boolean; className?: string; id?: string;
}) {
  const { data: units = [] } = useOrgUnits();
  const list = units.filter((u) => !types || types.includes(u.unit_type));
  // Sort by lineage names for a readable tree order.
  const key = (u: (typeof units)[number]) => [...(u.lineage || []).map((l) => l.name), u.name].join(' / ');
  list.sort((a, b) => key(a).localeCompare(key(b)));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid} className={className} aria-label={placeholder}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {types && types.length === 1 ? u.name : `${'— '.repeat(u.lineage?.length || 0)}${u.name} (${UNIT_LABELS[u.unit_type]})`}
        </option>
      ))}
    </Select>
  );
});
