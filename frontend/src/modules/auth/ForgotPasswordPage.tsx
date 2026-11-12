import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Field, FormError, Input } from '@/components/ui';
import { AuthShell } from './AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-reset/', { method: 'POST', body: { email } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="We will email a one-time link to the address on your account.">
      {done ? (
        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>If that email address is registered, a reset link is on its way. The link expires after a short time.</p>
          <p>No email access? Ask your administrator to issue a reset link from the Users page.</p>
          <Link to="/login" className="font-medium text-royal-700 dark:text-royal-300">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <FormError message={error} />
          <Field label="Email address" htmlFor="email" required>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
          <p className="text-center text-sm"><Link to="/login" className="text-royal-700 dark:text-royal-300">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
