import { describe, expect, it } from 'vitest';
import { hasErrors, validateLogin, validateSignup } from './validation';

describe('demo auth validation', () => {
  it('accepts any non-empty login', () => {
    expect(hasErrors(validateLogin({ identifier: 'x', password: 'y' }))).toBe(false);
  });
  it('rejects empty login fields', () => {
    expect(validateLogin({ identifier: '  ', password: '' })).toEqual({ identifier: expect.any(String), password: expect.any(String) });
  });
  it('requires signup name and matching passwords', () => {
    expect(hasErrors(validateSignup({ name: 'A', identifier: 'a', password: 'p', confirm: 'p' }))).toBe(false);
    expect(validateSignup({ name: '', identifier: 'a', password: 'p', confirm: 'q' })).toEqual({ name: expect.any(String), confirm: 'Passwords do not match.' });
  });
});
