import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { hasErrors, validateLogin, type FieldErrors, type LoginForm } from '@/auth/validation';
import { Button, Input } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { AuthShell, Field } from './AuthShell';

export function LoginPage() {
  const signIn = useAuthStore((s) => s.signIn);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [form, setForm] = useState<LoginForm>({ identifier: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<keyof LoginForm>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateLogin(form);
    setErrors(v); setFailure(null);
    if (hasErrors(v)) return;
    setBusy(true);
    try { await signIn(form.identifier, form.password); navigate(from, { replace: true }); }
    catch (err) { setFailure(err instanceof Error ? err.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Sign in" subtitle="Welcome back." footer={<>New here? <Link className="font-medium text-primary hover:underline" to="/signup">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Field label="Email or username" id="identifier" error={errors.identifier}>
          <Input id="identifier" className="w-full" autoComplete="username" autoFocus value={form.identifier} aria-invalid={!!errors.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
        </Field>
        <Field label="Password" id="password" error={errors.password}>
          <Input id="password" type="password" className="w-full" autoComplete="current-password" value={form.password} aria-invalid={!!errors.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {failure && <p role="alert" className="text-sm text-bad">{failure}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
    </AuthShell>
  );
}
