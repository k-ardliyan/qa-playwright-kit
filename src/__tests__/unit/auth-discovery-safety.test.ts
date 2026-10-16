import { test, expect } from '@playwright/test';
import { evaluateDiscoverySafety, isDestructiveOrLogoutUrl } from '../../shared/mcp/auth-discovery';

test.describe('auth-discovery safety contract', () => {
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
});
