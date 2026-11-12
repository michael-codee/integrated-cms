import { useEffect } from 'react';
import { NotificationBell } from '@/modules/notifications/NotificationBell';
import { SyncIndicator } from '@/components/SyncIndicator';
import { startSyncEngine } from '@/offline/sync';

/** Header widgets contributed by modules (sync status, notifications). Mounted only when signed in. */
export function HeaderExtras() {
  useEffect(() => startSyncEngine(), []);
  return <><SyncIndicator /><NotificationBell /></>;
}
