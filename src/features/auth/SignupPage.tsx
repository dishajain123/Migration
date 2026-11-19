import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hasErrors, validateSignup, type FieldErrors, type SignupForm } from '@/auth/validation';
import { Button, Input } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { AuthShell, Field } from './AuthShell';

export function SignupPage() {
  const signUp = useAuthStore((s) => s.signUp);
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupForm>({ name: '', identifier: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors<keyof SignupForm>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (k: keyof SignupForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validateSignup(form);
    setErrors(v); setFailure(null);
    if (hasErrors(v)) return;
    setBusy(true);
    try { await signUp(form.name, form.identifier, form.password); navigate('/', { replace: true }); }
    catch (err) { setFailure(err instanceof Error ? err.message : 'Sign-up failed.'); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell title="Create account" subtitle="Demo sign-up, no account is actually created." footer={<>Already have an account? <Link className="font-medium text-primary hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <Field label="Name" id="name" error={errors.name}>
          <Input id="name" className="w-full" autoComplete="name" autoFocus value={form.name} aria-invalid={!!errors.name} onChange={set('name')} />
        </Field>
        <Field label="Email or username" id="identifier" error={errors.identifier}>
          <Input id="identifier" className="w-full" autoComplete="username" value={form.identifier} aria-invalid={!!errors.identifier} onChange={set('identifier')} />
        </Field>
        <Field label="Password" id="password" error={errors.password}>
          <Input id="password" type="password" className="w-full" autoComplete="new-password" value={form.password} aria-invalid={!!errors.password} onChange={set('password')} />
        </Field>
        <Field label="Confirm password" id="confirm" error={errors.confirm}>
          <Input id="confirm" type="password" className="w-full" autoComplete="new-password" value={form.confirm} aria-invalid={!!errors.confirm} onChange={set('confirm')} />
        </Field>
        {failure && <p role="alert" className="text-sm text-bad">{failure}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</Button>
      </form>
    </AuthShell>
  );
}
