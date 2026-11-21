import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getPendingUpdate } from './register';

/**
 * Tells the user when a new version of the app has downloaded. The new version only takes over
 * when they choose to reload, so a form they are filling in is never thrown away.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState(getPendingUpdate);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onUpdate = () => setUpdate(() => getPendingUpdate());
    window.addEventListener('cmis:update-available', onUpdate);
    return () => window.removeEventListener('cmis:update-available', onUpdate);
  }, []);
  if (!update) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lift ring-1 ring-white/10 print:hidden">
      <RefreshCw className="h-4 w-4 shrink-0 text-gold-300" aria-hidden />
      <p className="min-w-0 flex-1">A new version of the app is ready. Save any open form, then reload to use it.</p>
      <Button size="sm" variant="gold" loading={busy} onClick={() => { setBusy(true); void update(true); }}>Reload</Button>
    </div>
  );
}
