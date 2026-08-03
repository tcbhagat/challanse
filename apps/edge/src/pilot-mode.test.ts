import { describe, expect, it } from 'vitest';
import { pilotModeFor } from './handlers/devices';

describe('pilotModeFor (mobile PilotConfiguration pilotMode)', () => {
  it('reserves synthetic-demo for the local pilot and development runtimes only', () => {
    expect(pilotModeFor('local-pilot')).toBe('synthetic-demo');
    expect(pilotModeFor('development')).toBe('synthetic-demo');
  });

  it('returns controlled-client-pilot for production and unknown runtimes', () => {
    expect(pilotModeFor('production')).toBe('controlled-client-pilot');
    expect(pilotModeFor('staging')).toBe('controlled-client-pilot');
    expect(pilotModeFor(undefined)).toBe('controlled-client-pilot');
    expect(pilotModeFor('')).toBe('controlled-client-pilot');
  });
});
