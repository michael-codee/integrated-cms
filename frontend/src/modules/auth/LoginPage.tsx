import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { ApiError, OfflineError } from '@/lib/api';
import { Button, Field, FormError, Input } from '@/components/ui';
import { AuthShell } from './AuthShell';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from || '/';

  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Enter your username (or email) and password.');
      return;
    }
    setBusy(true);
    try {
      const me = await login(username.trim(), password);
      navigate(me.must_change_password ? '/profile?tab=password&required=1' : from, { replace: true });
    } catch (err) {
      if (err instanceof OfflineError) setError('Cannot reach the server. You need an internet connection the first time you sign in on this device.');
      else if (err instanceof ApiError) setError(err.message);
      else setError('Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the account issued by your church administrator.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError message={error} />
        <Field label="Username or email" htmlFor="username" required>
          <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <div className="relative">
            <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-royal-700 hover:text-royal-900 dark:text-royal-300">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={busy} icon={<LogIn className="h-4 w-4" />}>Sign in</Button>
        <p className="text-center text-xs text-slate-400">Access is restricted to authorised church officers. All activity is recorded.</p>
      </form>
    </AuthShell>
  );
}
