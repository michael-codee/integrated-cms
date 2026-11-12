import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, CloudUpload, RefreshCw } from 'lucide-react';
import { useOutbox, useSyncStatus } from '@/offline/useSync';

/** Header shortcut to the Sync Centre; only visible when something is waiting or syncing. */
export function SyncIndicator() {
  const { pending, failed, conflicts } = useOutbox();
  const { phase } = useSyncStatus();
  const busy = phase === 'pushing' || phase === 'pulling';
  const problems = failed + conflicts;
  if (!pending && !problems && !busy) return null;
  return (
    <Link to="/sync" title="Open the Sync Centre"
      className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        problems ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-royal-50 text-royal-700 dark:bg-royal-900/50 dark:text-royal-200')}>
      {problems ? <AlertTriangle className="h-3.5 w-3.5" /> : busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
      {problems ? `${problems} need attention` : pending ? `${pending} to upload` : 'Syncing'}
    </Link>
  );
}
