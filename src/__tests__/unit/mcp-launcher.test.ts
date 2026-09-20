import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseLauncherArgs,
  resolveLauncherConfig,
  launcherTenantWarning,
} from '../../../tools/scripts/playwright-mcp-launch';
import { buildPlaywrightMcpArgs } from '../../shared/mcp/arg-builder';
import { resolveAllowedOrigins, normalizeOrigin } from '../../shared/mcp/origin-resolver';

test.describe('Playwright MCP Launcher & Config (MCP-017)', () => {
  test('parses launcher arguments correctly', () => {
    const args = parseLauncherArgs([
      '--profile=debug',
      '--role=finance',
      '--browser=firefox',
      '--headed',
      '--persistent',
      '--caps=core,network,testing',
    ]);

    expect(args.profile).toBe('debug');
    expect(args.role).toBe('finance');
    expect(args.browser).toBe('firefox');
    expect(args.headless).toBe(false);
    expect(args.isolated).toBe(false);
    expect(args.caps).toEqual(['core', 'network', 'testing']);
  });

  test('resolves default author profile runtime config', () => {
    const config = resolveLauncherConfig(['--profile=author']);

    expect(config.intent).toBe('author');
    expect(config.headless).toBe(true);
    expect(config.isolated).toBe(true);
    expect(config.capabilities).toContain('testing');
    expect(config.capabilities).toContain('storage');
    expect(config.capabilities).toContain('core');
    expect(config.outputDir).toContain('test-results');
  });

  test('builds official CLI arguments accurately for isolated author profile', () => {
    const config = resolveLauncherConfig(['--profile=author', '--role=finance']);
    const cliArgs = buildPlaywrightMcpArgs(config);

    expect(cliArgs).toContain('--headless');
    expect(cliArgs).toContain('--isolated');
    // author has no additive caps (core/testing/storage/config are 0.0.79 base caps)
    expect(cliArgs.some((a) => a.startsWith('--caps='))).toBe(false);
    expect(cliArgs.some((a) => a.startsWith('--output-dir='))).toBe(true);
    expect(cliArgs.some((a) => a.startsWith('--storage-state='))).toBe(true);
    // installed 0.0.79 expects semicolon-separated origins
    const originsArg = cliArgs.find((a) => a.startsWith('--allowed-origins='));
    expect(originsArg).toBeDefined();
    expect(originsArg!.includes(',')).toBe(false);
  });

  test('joins multiple allowed origins with semicolons for the installed CLI', () => {
    const config = resolveLauncherConfig(['--profile=author', '--role=finance']);
    const multiOrigin = { ...config, allowedOrigins: ['https://app.test', 'https://api.app.test'] };
    const cliArgs = buildPlaywrightMcpArgs(multiOrigin);
    const originsArg = cliArgs.find((a) => a.startsWith('--allowed-origins='));
    expect(originsArg).toBe('--allowed-origins=https://app.test;https://api.app.test');
  });

  test('passes only CLI-additive capabilities to --caps per profile', () => {
    const author = buildPlaywrightMcpArgs(resolveLauncherConfig(['--profile=author']));
    expect(author.some((a) => a.startsWith('--caps='))).toBe(false);

    const debug = buildPlaywrightMcpArgs(resolveLauncherConfig(['--profile=debug']));
    expect(debug).toContain('--caps=devtools');

    const visual = buildPlaywrightMcpArgs(resolveLauncherConfig(['--profile=visual']));
    expect(visual).toContain('--caps=vision');

    const artifact = buildPlaywrightMcpArgs(resolveLauncherConfig(['--profile=artifact']));
    expect(artifact).toContain('--caps=pdf');
  });

  test('omits the framework-default browser and passes explicit engines', () => {
    const defaultCfg = resolveLauncherConfig(['--profile=author']);
    expect(buildPlaywrightMcpArgs(defaultCfg).some((a) => a.startsWith('--browser='))).toBe(false);

    const firefoxCfg = resolveLauncherConfig(['--profile=debug', '--browser=firefox']);
    expect(buildPlaywrightMcpArgs(firefoxCfg)).toContain('--browser=firefox');
  });

  test('normalizes origins and avoids wildcard', () => {
    expect(normalizeOrigin('http://localhost:3000/some/path')).toBe('http://localhost:3000');
    expect(normalizeOrigin('https://dev.app.com:8443')).toBe('https://dev.app.com:8443');
    expect(normalizeOrigin('*')).toBeNull();
    expect(normalizeOrigin('invalid-url')).toBeNull();

    const resolved = resolveAllowedOrigins({ baseUrl: 'http://localhost:8080/app' });
    expect(resolved).toContain('http://localhost:8080');
  });

  test('warns when --role session belongs to another company, still attaches it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tenant-'));
    const authFile = path.join(dir, 'finance.json');
    fs.writeFileSync(
      authFile,
      JSON.stringify({ cookies: [], origins: [], _qaKit: { company: 'acme' } }),
    );
    const config = { role: 'finance', storageStatePath: authFile };
    const env = { FINANCE_COMPANY: 'globex' };
    const warning = launcherTenantWarning(config, env);
    expect(warning).toContain('FINANCE_COMPANY');
    expect(warning).toContain('npm run auth:setup');
    expect(launcherTenantWarning(config, { FINANCE_COMPANY: 'acme' })).toBeNull();
    expect(launcherTenantWarning({ role: 'finance' }, env)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
