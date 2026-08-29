import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { resolveMcpAuthState } from '../../shared/mcp/auth-resolver';
import { probeAuthStateFile } from '../../shared/mcp/auth-probe';

test.describe('MCP Auth Resolver & Storage State Probe', () => {
  test('resolves default user role when role is omitted or empty', () => {
    const resDefault = resolveMcpAuthState({ environment: 'local' });
    expect(resDefault.role).toBe('user');
    expect(resDefault.storagePath).toContain('user.json');

    const resEmpty = resolveMcpAuthState({ role: '', environment: 'local' });
    expect(resEmpty.role).toBe('user');
    expect(resEmpty.storagePath).toContain('user.json');

    const resWhitespace = resolveMcpAuthState({ role: '   ', environment: 'local' });
    expect(resWhitespace.role).toBe('user');
  });

  test('resolves custom role and provides actionable diagnostic when file is missing', () => {
    const res = resolveMcpAuthState({ role: 'finance', environment: 'nonexistent_env' });
    expect(res.role).toBe('finance');
    expect(res.environment).toBe('nonexistent_env');
    expect(res.exists).toBe(false);
    expect(res.diagnosticMessage).toContain("Storage state for role 'finance'");
    expect(res.recommendedCommand).toBe('npm run auth:setup');
  });

  test('probes missing auth state file', () => {
    const res = probeAuthStateFile('/path/to/nonexistent-file.json');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('missing');
  });

  test('probes malformed JSON or empty object', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-probe-test-'));
    try {
      const malformedPath = path.join(tempDir, 'malformed.json');
      fs.writeFileSync(malformedPath, '{ not valid json', 'utf-8');
      const resMalformed = probeAuthStateFile(malformedPath);
      expect(resMalformed.valid).toBe(false);
      expect(resMalformed.status).toBe('malformed');

      const emptyPath = path.join(tempDir, 'empty.json');
      fs.writeFileSync(emptyPath, '{}', 'utf-8');
      const resEmpty = probeAuthStateFile(emptyPath);
      expect(resEmpty.valid).toBe(false);
      expect(resEmpty.status).toBe('malformed');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('probes valid active session with cookies and origins', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-probe-test-'));
    try {
      const validPath = path.join(tempDir, 'valid.json');
      const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
      fs.writeFileSync(
        validPath,
        JSON.stringify({
          cookies: [{ name: 'session_id', value: 'xyz123', expires: futureSeconds }],
          origins: [
            { origin: 'http://localhost:3000', localStorage: [{ name: 'theme', value: 'dark' }] },
          ],
        }),
        'utf-8',
      );

      const res = probeAuthStateFile(validPath);
      expect(res.valid).toBe(true);
      expect(res.status).toBe('valid');
      expect(res.cookiesCount).toBe(1);
      expect(res.expiredCookiesCount).toBe(0);
      expect(res.originsCount).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('probes expired cookies session', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-probe-test-'));
    try {
      const expiredPath = path.join(tempDir, 'expired.json');
      const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
      fs.writeFileSync(
        expiredPath,
        JSON.stringify({
          cookies: [
            { name: 'session_id', value: 'xyz123', expires: pastSeconds },
            { name: 'auth_token', value: 'abc999', expires: pastSeconds },
          ],
          origins: [],
        }),
        'utf-8',
      );

      const res = probeAuthStateFile(expiredPath);
      expect(res.valid).toBe(false);
      expect(res.status).toBe('expired');
      expect(res.expiredCookiesCount).toBe(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
