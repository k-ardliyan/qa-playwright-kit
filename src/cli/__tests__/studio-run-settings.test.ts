import { test, expect } from '@playwright/test';
import {
  normalizeRunSettings,
  normalizeViewport,
  runSettingsEnvUpserts,
} from '../studio-run-settings';

/**
 * Unit tests for the studio run-settings validator.
 * Run: npx playwright test src/cli/__tests__/studio-run-settings.test.ts -c config/playwright/unit.ts
 *
 * These knobs reach a real Playwright child (SLOW_MO / HEADLESS / QA_VIEWPORT),
 * so the validator must drop junk instead of forwarding it.
 */

test.describe('normalizeRunSettings', () => {
  test('maps valid values to their env vars', () => {
    const { env, warnings } = normalizeRunSettings({
      slowMo: 250,
      headless: false,
      viewport: '1600x900',
    });
    expect(env).toEqual({ SLOW_MO: '250', HEADLESS: 'false', QA_VIEWPORT: '1600x900' });
    expect(warnings).toEqual([]);
  });

  test('empty settings produce no env and no warnings', () => {
    expect(normalizeRunSettings({})).toEqual({ env: {}, warnings: [] });
  });

  test('drops out-of-range slow-mo with a warning', () => {
    const { env, warnings } = normalizeRunSettings({ slowMo: -5 });
    expect(env.SLOW_MO).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('slow-mo');
  });

  test('drops non-boolean headless with a warning', () => {
    const { env, warnings } = normalizeRunSettings({
      headless: 'yes' as unknown as boolean,
    });
    expect(env.HEADLESS).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  test('drops a malformed viewport with a warning', () => {
    const { env, warnings } = normalizeRunSettings({ viewport: 'wide' });
    expect(env.QA_VIEWPORT).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

test.describe('normalizeViewport', () => {
  test('accepts WIDTHxHEIGHT and normalizes case', () => {
    expect(normalizeViewport('1920X1080')).toBe('1920x1080');
    expect(normalizeViewport(' 1366x768 ')).toBe('1366x768');
  });

  test('rejects below the runtime floor (320x240)', () => {
    expect(normalizeViewport('10x10')).toBeNull();
    expect(normalizeViewport('1920x100')).toBeNull();
  });

  test('rejects non-string and garbage', () => {
    expect(normalizeViewport(1920)).toBeNull();
    expect(normalizeViewport('1920x1080x2')).toBeNull();
    expect(normalizeViewport('')).toBeNull();
  });
});

test.describe('runSettingsEnvUpserts', () => {
  test('returns only valid keys for persisting', () => {
    expect(runSettingsEnvUpserts({ slowMo: 100, viewport: 'bad' })).toEqual({ SLOW_MO: '100' });
  });
});
