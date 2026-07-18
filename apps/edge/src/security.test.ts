import { describe, expect, it } from 'vitest';
import { allowedOrigins, authenticateAccessIdentity, randomEnrollmentCode, sha256Hex } from './security';
import type { Env } from './types';

describe('edge security primitives', () => {
  it('accepts only configured exact origins', () => {
    const env = { ALLOWED_ORIGINS: 'https://challanse.constrovet.com,https://review.challanse.constrovet.com' } as Env;
    const origins = allowedOrigins(env);
    expect(origins.has('https://review.challanse.constrovet.com')).toBe(true);
    expect(origins.has('https://evil.constrovet.com')).toBe(false);
  });

  it('creates human-safe one-time codes and deterministic hashes', async () => {
    expect(randomEnrollmentCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await sha256Hex('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('accepts only an allowlisted reviewer from the local trusted gateway', async () => {
    const env = {
      ENVIRONMENT: 'local-pilot',
      LOCAL_REVIEWER_GATEWAY_SECRET: 'gateway-secret',
      LOCAL_REVIEWER_EMAILS: 'admin@constrovet.com,bhagat.taran@gmail.com',
    } as Env;
    const accepted = await authenticateAccessIdentity(new Request('https://pilot.test/v1/reviewer/context', {
      headers: {
        'X-ChallanSe-Local-Reviewer-Secret': 'gateway-secret',
        'X-ChallanSe-Local-Reviewer-Email': 'admin@constrovet.com',
      },
    }), env);
    expect(accepted).toEqual({
      issuer: 'https://local-pilot.challanse',
      subject: 'local:admin@constrovet.com',
      email: 'admin@constrovet.com',
    });
    const rejected = await authenticateAccessIdentity(new Request('https://pilot.test/v1/reviewer/context', {
      headers: {
        'X-ChallanSe-Local-Reviewer-Secret': 'wrong',
        'X-ChallanSe-Local-Reviewer-Email': 'admin@constrovet.com',
      },
    }), env);
    expect(rejected).toBeNull();
  });
});
