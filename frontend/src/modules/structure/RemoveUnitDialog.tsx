import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { OrgUnit } from '@/app/types';
import { Button, Modal, PageLoader, useToast } from '@/components/ui';

interface Dependencies {
  removable: boolean;
  dependencies: { key: string; label: string; count: number }[];
  active_children: number;
}

/**
 * Removing a unit is only for one added by mistake. A unit with members,
 * money, records or units below it is never removed: the dialog lists what is
 * attached and offers to close it instead, which keeps its history.
 */
export function RemoveUnitDialog({ open, unit, onClose, onCloseInstead }: {
  open: boolean; unit: OrgUnit; onClose: () => void; onCloseInstead: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const deps = useQuery({
    queryKey: ['org-units', unit.id, 'dependencies'],
    queryFn: () => api<Dependencies>(`/org-units/${unit.id}/dependencies/`),
    enabled: open,
    staleTime: 0,
  });

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/org-units/${unit.id}/`, { method: 'DELETE' });
      toast.success(`${unit.name} was removed.`);
      onClose();
      navigate(unit.parent ? `/structure?unit=${unit.parent}` : '/structure');
      qc.invalidateQueries({ queryKey: ['org-units'] });
      qc.invalidateQueries({ queryKey: ['structure-levels'] });
    } catch (e) {
      toast.error((e as Error).message);
      deps.refetch();
    } finally {
      setBusy(false);
    }
  };

  const data = deps.data;
  const canClose = unit.status === 'active';
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Remove ${unit.name}?`}
      footer={!data ? <Button variant="secondary" onClick={onClose}>Cancel</Button> : data.removable ? (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={remove} loading={busy}>Remove</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {canClose && <Button variant="danger" onClick={onCloseInstead}>Close it instead</Button>}
        </>
      )}>
      {deps.isLoading || !data ? <PageLoader /> : (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          {data.removable ? (
            <p>Nothing is attached to {unit.name}. It will be taken off the church structure; the removal is recorded in the audit trail.</p>
          ) : (
            <>
              <p>{unit.name} cannot be removed because these records still belong to it:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {data.dependencies.map((d) => <li key={d.key}><b>{d.count}</b> {d.label.toLowerCase()}</li>)}
              </ul>
              <p>
                {canClose
                  ? 'Close the unit instead. It is marked inactive and keeps its members, finances and history, so nothing is lost. To remove it completely, first move those records to another unit.'
                  : 'The unit is already closed and its records are kept. To remove it completely, first move those records to another unit.'}
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
