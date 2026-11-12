import { NotificationBell } from '@/modules/notifications/NotificationBell';

/** Header widgets contributed by modules (notifications, sync status). */
export function HeaderExtras() {
  return <NotificationBell />;
}
