import { test, expect } from '@playwright/test';
import { validateAuthAssistConfig } from '../../shared/mcp/auth-assist';
import { evaluateVisionFallback, isCoordinateSelector } from '../../shared/mcp/vision-policy';
import { evaluateDiscoverySafety, isDestructiveOrLogoutUrl } from '../../shared/mcp/auth-discovery';
import {
  computeSemanticEnvironmentDiff,
  type PageSemanticSnapshot,
} from '../../shared/mcp/env-diff';

test.describe('Advanced MCP Capabilities (Milestone 4: MCP-073 to MCP-095)', () => {
  test('validates auth-assist configuration and guards CI', () => {
    const valid = validateAuthAssistConfig(
      {
        mode: 'interactive-headed',
        environment: 'dev',
        role: 'super-admin',
        expectedOrigin: 'http://localhost:3000',
        localOnly: true,
      },
      { isCi: false },
    );
    expect(valid.valid).toBe(true);

    const ciGuarded = validateAuthAssistConfig(
      {
        mode: 'interactive-headed',
        environment: 'dev',
        role: 'super-admin',
        expectedOrigin: 'http://localhost:3000',
        localOnly: true,
      },
      { isCi: true },
    );
    expect(ciGuarded.valid).toBe(false);
    expect(ciGuarded.errors).toContain('Interactive headed auth-assist mode cannot run under CI');

    const invalid = validateAuthAssistConfig({
      mode: 'cdp-connect',
      environment: 'dev',
      role: '',
      expectedOrigin: 'not-a-url',
      localOnly: true,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  test('generates accessibility warning for normal controls needing vision', () => {
    const res = evaluateVisionFallback({
      target: 'Submit Order Button',
      category: 'inaccessible-widget',
      explanation: 'No accessibility node',
      isNormalSemanticControl: true,
    });

    expect(res.allowed).toBe(true);
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0].recommendation).toContain('Add role, aria-label');
  });

  test('identifies coordinate-based selectors', () => {
    expect(isCoordinateSelector('page.mouse.click(100, 200)')).toBe(true);
    expect(isCoordinateSelector('coords: 120, 340')).toBe(true);
    expect(isCoordinateSelector("page.getByRole('button', { name: 'Save' })")).toBe(false);
  });

  test('enforces discovery safety contract and filters logout routes', () => {
    const safeCheck = evaluateDiscoverySafety({
      enabled: true,
      role: 'admin',
      environment: 'staging',
      rootUrl: 'https://staging.app.com',
      allowedOrigins: ['https://staging.app.com'],
    });
    expect(safeCheck.safe).toBe(true);

    expect(isDestructiveOrLogoutUrl('/api/v1/auth/logout')).toBe(true);
    expect(isDestructiveOrLogoutUrl('/users/delete/42')).toBe(true);
    expect(isDestructiveOrLogoutUrl('/dashboard/overview')).toBe(false);
  });

  test('computes semantic environment diff between two snapshots', () => {
    const env1: PageSemanticSnapshot = {
      environment: 'staging',
      url: 'https://staging.app.com/dashboard',
      headings: ['Dashboard', 'Recent Sales'],
      actionButtons: ['Export CSV', 'New Order'],
      consoleErrors: [],
      statusCode: 200,
    };

    const env2: PageSemanticSnapshot = {
      environment: 'prod',
      url: 'https://app.com/dashboard',
      headings: ['Dashboard'], // missing 'Recent Sales'
      actionButtons: ['Export CSV', 'New Order', 'Live Chat'],
      consoleErrors: ['Uncaught ReferenceError'],
      statusCode: 200,
    };

    const diff = computeSemanticEnvironmentDiff(env1, env2);
    expect(diff.hasDifferences).toBe(true);
    expect(diff.missingHeadings.inEnv1Only).toContain('Recent Sales');
    expect(diff.missingActions.inEnv2Only).toContain('Live Chat');
    expect(diff.consoleErrorDiff.env2Errors.length).toBe(1);
  });
});
