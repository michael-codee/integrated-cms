import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { download, type Query } from '@/lib/api';
import { useAuth } from '@/app/AuthContext';
import { Button, useToast } from './ui';

/** PDF / Excel / CSV export of the current (filtered, jurisdiction-scoped) list. */
export function ExportMenu({ path, params, module, name }: { path: string; params?: Query; module: string; name: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!can(`${module}.export`) && !can(`${module}.print`)) return null;
  const run = async (fmt: 'xlsx' | 'csv' | 'pdf') => {
    setBusy(fmt);
    setOpen(false);
    try {
      await download(path, { ...(params || {}), file_format: fmt }, `${name}.${fmt}`);
    } catch (e) {
      toast.error((e as Error).message || 'Export failed. Exports need an internet connection.');
    } finally {
      setBusy(null);
    }
  };
  const items = [
    { fmt: 'pdf' as const, label: 'PDF report', icon: Printer, perm: `${module}.print` },
    { fmt: 'xlsx' as const, label: 'Excel workbook', icon: FileSpreadsheet, perm: `${module}.export` },
    { fmt: 'csv' as const, label: 'CSV file', icon: FileText, perm: `${module}.export` },
  ].filter((i) => can(i.perm));
  return (
    <div className="relative">
      <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={!!busy} onClick={() => setOpen((o) => !o)}>Export</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {items.map((i) => (
              <button key={i.fmt} onClick={() => run(i.fmt)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                <i.icon className="h-4 w-4 text-slate-400" /> {i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
