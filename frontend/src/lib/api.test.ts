import { ApiError, buildQuery } from './api';
import { passwordProblems } from '@/modules/auth/password';
import { money } from './format';

describe('api helpers', () => {
  it('builds query strings skipping empty values', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: ['x', 'y'] })).toBe('?a=1&d=x&d=y');
  });

  it('extracts DRF field errors', () => {
    const err = new ApiError(400, { email: ['Enter a valid email.'], detail: 'x' });
    expect(err.fieldErrors).toEqual({ email: 'Enter a valid email.' });
    expect(err.message).toBe('x');
  });

  it('uses the first field error as message when no detail', () => {
    expect(new ApiError(400, { amount: ['Must be positive.'] }).message).toBe('amount: Must be positive.');
  });
});

describe('password rules', () => {
  it('rejects short, numeric and common passwords', () => {
    expect(passwordProblems('short')).not.toHaveLength(0);
    expect(passwordProblems('12345678901')).not.toHaveLength(0);
    expect(passwordProblems('Password-123')).not.toHaveLength(0);
    expect(passwordProblems('Rivers-of-Living-Water-7')).toHaveLength(0);
  });
});

describe('format', () => {
  it('formats Leones', () => {
    expect(money(1500)).toMatch(/1,500/);
  });
});
