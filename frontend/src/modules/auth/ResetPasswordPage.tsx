import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Button, Field, FormError, Input } from '@/components/ui';
import { AuthShell } from './AuthShell';
import { passwordProblems } from './password';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblems(pw)[0];
    if (problem) return setError(problem);
    if (pw !== pw2) return setError('The passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-reset/confirm/', { method: 'POST', body: { token, new_password: pw } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      {!token ? (
        <p className="text-sm text-red-600">This link is incomplete. Request a new reset link.</p>
      ) : done ? (
        <div className="space-y-3 text-sm">
          <p className="text-emerald-700 dark:text-emerald-300">Your password has been changed.</p>
          <Link to="/login" className="font-medium text-royal-700 dark:text-royal-300">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <FormError message={error} />
          <Field label="New password" required hint="At least 10 characters; avoid common words and all-number passwords.">
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>Set password</Button>
        </form>
      )}
    </AuthShell>
  );
}
