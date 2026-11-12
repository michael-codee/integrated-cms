import { CloudUpload } from 'lucide-react';
import { Badge } from './ui';

/** Distinguishes records saved only on this device from server-confirmed ones. */
export function SyncBadge({ state }: { state?: string }) {
  if (!state || state === 'synced') return null;
  if (state === 'conflict') return <Badge tone="red">conflict</Badge>;
  if (state === 'failed') return <Badge tone="red">sync failed</Badge>;
  return <Badge tone="yellow"><CloudUpload className="h-3 w-3" /> on this device</Badge>;
}
