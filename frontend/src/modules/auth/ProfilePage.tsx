import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/AuthContext';
import { api, ApiError, setAccessToken } from '@/lib/api';
import { Button, Card, CardBody, CardHeader, DescriptionList, Field, FormError, FormGrid, Input, PageHeader, StatusBadge, Tabs, useToast } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { passwordProblems } from './password';

export default function ProfilePage() {
  const { user, reload } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'details' | 'password') || 'details';
  const required = params.get('required') === '1' || user?.must_change_password;
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: user?.full_name || '', title: user?.title || '', phone: user?.phone || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return setErrors({ full_name: 'Full name is required.' });
    setBusy(true);
    try {
      await api('/auth/me/', { method: 'PATCH', body: form });
      await reload();
      toast.success('Profile updated.');
      setErrors({});
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: err.message });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!pw.current_password) errs.current_password = 'Enter your current password.';
    const problem = passwordProblems(pw.new_password)[0];
    if (problem) errs.new_password = problem;
    if (pw.new_password !== pw.confirm) errs.confirm = 'The passwords do not match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await api<{ access: string }>('/auth/change-password/', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } });
      setAccessToken(res.access);
      await reload();
      toast.success('Password changed. Other sessions have been signed out.');
      setPw({ current_password: '', new_password: '', confirm: '' });
      if (required) navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? '' : err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="My profile" crumbs={[{ label: 'Home', to: '/' }, { label: 'Profile' }]} />
      {required && (
        <div className="mb-4 rounded-lg border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-gold-900 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-100">
          For security, please choose a new personal password before continuing.
        </div>
      )}
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: 'details', label: 'Details' }, { value: 'password', label: 'Password' }]} />
      {tab === 'details' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Personal details" />
            <CardBody>
              <form onSubmit={saveDetails} className="space-y-4">
                <FormError message={errors.form} />
                <FormGrid>
                  <Field label="Full name" required error={errors.full_name}><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
                  <Field label="Title" hint="e.g. Rev., Pastor, Bishop"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                  <Field label="Phone" error={errors.phone}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                  <Field label="Email" hint="Contact your administrator to change it."><Input value={user.email} disabled /></Field>
                </FormGrid>
                <div className="flex justify-end"><Button type="submit" loading={busy}>Save changes</Button></div>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Account" />
            <CardBody className="space-y-4">
              <DescriptionList items={[
                { label: 'Username', value: user.username },
                { label: 'Status', value: <StatusBadge status={user.status} /> },
                { label: 'Last sign-in', value: dateTime(user.last_login) },
              ]} />
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500">Roles & jurisdiction</p>
                <ul className="space-y-2">
                  {user.assignments.map((a) => (
                    <li key={a.id} className="rounded-lg bg-royal-50 px-3 py-2 text-sm dark:bg-royal-900/30">
                      <p className="font-medium text-royal-900 dark:text-royal-100">{a.role_name}</p>
                      <p className="text-xs text-royal-700 dark:text-royal-300">{a.org_unit_name}</p>
                    </li>
                  ))}
                  {user.assignments.length === 0 && <li className="text-sm text-slate-500">No active role. Contact your administrator.</li>}
                </ul>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <Card className="max-w-xl">
          <CardHeader title="Change password" subtitle="Changing your password signs out your other devices." />
          <CardBody>
            <form onSubmit={changePassword} className="space-y-4" noValidate>
              <FormError message={errors.form} />
              <Field label="Current password" required error={errors.current_password}><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
              <Field label="New password" required error={errors.new_password} hint="At least 10 characters."><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
              <Field label="Confirm new password" required error={errors.confirm}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
              <div className="flex justify-end"><Button type="submit" loading={busy}>Change password</Button></div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
