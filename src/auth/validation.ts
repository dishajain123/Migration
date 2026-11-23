// Pure form validation for the demo auth pages. Demo mode only checks for non-empty values.

export interface LoginForm { identifier: string; password: string }
export interface SignupForm { name: string; identifier: string; password: string; confirm: string }
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateLogin(f: LoginForm): FieldErrors<keyof LoginForm> {
  const e: FieldErrors<keyof LoginForm> = {};
  if (!f.identifier.trim()) e.identifier = 'Enter your email or username.';
  if (!f.password) e.password = 'Enter your password.';
  return e;
}

export function validateSignup(f: SignupForm): FieldErrors<keyof SignupForm> {
  const e: FieldErrors<keyof SignupForm> = {};
  if (!f.name.trim()) e.name = 'Enter your name.';
  if (!f.identifier.trim()) e.identifier = 'Enter an email or username.';
  if (!f.password) e.password = 'Choose a password.';
  if (!f.confirm) e.confirm = 'Confirm your password.';
  else if (f.password && f.confirm !== f.password) e.confirm = 'Passwords do not match.';
  return e;
}

export const hasErrors = (e: object) => Object.keys(e).length > 0;
