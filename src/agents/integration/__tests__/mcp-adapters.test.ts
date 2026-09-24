import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMcpAdapters } from '../mcp-adapters';

function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function writeCatalog(repoRoot: string, args: Record<string, unknown>): void {
  const featureName = String(args.featureName);
  const catalogDir = path.join(repoRoot, 'artifacts', 'selector-catalog', featureName);
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(
    path.join(catalogDir, `${String(args.pageName)}.json`),
    JSON.stringify({ url: args.url, role: args.role, featureName }),
  );
}

test.describe('createMcpAdapters Explore', () => {
  test('rejects a cross-origin requirement startPage before opening a browser', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let snapshotCalled = false;

    try {
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: 'https://attacker.example/invoices',
                auth: { state: 'unauthenticated' },
              },
            }),
            snapshotPage: async () => {
              snapshotCalled = true;
              return { status: 'success' };
            },
          },
        });

        await expect(
          adapters.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('same http(s) origin as BASE_URL');
      });

      expect(snapshotCalled).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('rejects existing catalog evidence captured for another role', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    try {
      const staleDir = path.join(repoRoot, 'artifacts', 'selector-catalog', 'invoices');
      fs.mkdirSync(staleDir, { recursive: true });
      fs.writeFileSync(
        path.join(staleDir, 'old.json'),
        JSON.stringify({ url: 'https://staging.example.test/invoices', role: 'finance' }),
      );
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'hrd' },
              },
            }),
            snapshotPage: async () => ({ status: 'success' }),
          },
        });
        await expect(
          adapters.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('different role or target URL');
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('rejects authenticated snapshots that report missing or mismatched session warnings', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));

    try {
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'finance' },
              },
            }),
            snapshotPage: async (args) => {
              writeCatalog(repoRoot, args);
              return {
                status: 'success',
                warnings: ['No session found for role "finance" — captured unauthenticated.'],
              };
            },
          },
        });

        await expect(
          adapters.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('did not use role');
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('blocks URL-driven Explore in production before snapshotting', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let snapshotCalled = false;

    try {
      await withEnv({ BASE_URL: 'https://app.example.test', APP_ENV: 'production' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: { startPage: '/invoices', auth: { state: 'unauthenticated' } },
            }),
            snapshotPage: async () => {
              snapshotCalled = true;
              return { status: 'success' };
            },
          },
        });

        await expect(
          adapters.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('blocked for APP_ENV=production');
      });

      expect(snapshotCalled).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('rejects non-http BASE_URL before snapshotting', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let snapshotCalled = false;
    try {
      await withEnv({ BASE_URL: 'file:///etc/passwd', APP_ENV: 'staging' }, async () => {
        const adapter = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: { startPage: '/invoices', auth: { state: 'unauthenticated' } },
            }),
            snapshotPage: async () => {
              snapshotCalled = true;
              return { status: 'success' };
            },
          },
        });
        await expect(
          adapter.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('BASE_URL must be an absolute http(s) URL');
      });
      expect(snapshotCalled).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('rejects explicit URL credentials before snapshotting', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let snapshotCalled = false;
    try {
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapter = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: 'https://user:secret@staging.example.test/invoices',
                auth: { state: 'unauthenticated' },
              },
            }),
            snapshotPage: async () => {
              snapshotCalled = true;
              return { status: 'success' };
            },
          },
        });
        await expect(
          adapter.explore({ requirementPath: 'requirements/invoices.md', force: true }),
        ).rejects.toThrow('must not contain URL credentials');
      });
      expect(snapshotCalled).toBe(false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('does not attach a role for a public unauthenticated requirement', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let captured: Record<string, unknown> | undefined;

    try {
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: { startPage: '/public', auth: { state: 'unauthenticated' } },
            }),
            snapshotPage: async (args) => {
              captured = args;
              writeCatalog(repoRoot, args);
              return { status: 'success' };
            },
          },
        });

        await adapters.explore({ requirementPath: 'requirements/invoices.md', role: 'finance' });
      });

      expect(captured).not.toHaveProperty('role');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('reports malformed BASE_URL as an actionable Explore error', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));

    try {
      await withEnv({ BASE_URL: 'not-a-url', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'finance' },
              },
            }),
            snapshotPage: async () => ({ status: 'success' }),
          },
        });

        await expect(
          adapters.explore({ requirementPath: 'requirements/invoices.md' }),
        ).rejects.toThrow('[mcp-adapters] Explore BASE_URL must be a valid absolute http(s) URL.');
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('uses requirement startPage and default role when capturing live evidence', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let captured: Record<string, unknown> | undefined;

    try {
      await withEnv(
        { BASE_URL: 'https://staging.example.test/base/', APP_ENV: 'staging' },
        async () => {
          const adapters = createMcpAdapters({
            repoRoot,
            tools: {
              compileRequirement: async () => ({
                status: 'success',
                data: {
                  startPage: '/invoices/approved',
                  auth: { state: 'authenticated', defaultRole: 'finance' },
                },
              }),
              snapshotPage: async (args) => {
                captured = args;
                writeCatalog(repoRoot, args);
                return { status: 'success' };
              },
            },
          });

          await adapters.explore({ requirementPath: 'requirements/invoices.md' });
        },
      );

      expect(captured).toMatchObject({
        url: 'https://staging.example.test/invoices/approved',
        role: 'finance',
        pageName: 'invoices-approved-finance',
      });
      await withEnv(
        { BASE_URL: 'https://staging.example.test/base/', APP_ENV: 'staging' },
        async () => {
          const adapter = createMcpAdapters({
            repoRoot,
            tools: {
              compileRequirement: async () => ({
                status: 'success',
                data: {
                  startPage: '/invoices/approved',
                  auth: { state: 'authenticated', defaultRole: 'finance' },
                },
              }),
              snapshotPage: async () => ({ status: 'success' }),
            },
          });
          expect(
            (await adapter.explore({ requirementPath: 'requirements/invoices.md' })).evidence,
          ).toHaveLength(1);
        },
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('reuses matching durable evidence without requiring snapshot tool', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    try {
      writeCatalog(repoRoot, {
        featureName: 'invoices',
        pageName: 'invoices-finance',
        url: 'https://staging.example.test/invoices',
        role: 'finance',
      });
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapter = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'finance' },
              },
            }),
          },
        });
        expect(
          (await adapter.explore({ requirementPath: 'requirements/invoices.md' })).evidence,
        ).toHaveLength(1);
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('uses the configured URL path when the compiled requirement has no startPage', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let captured: Record<string, unknown> | undefined;
    try {
      await withEnv(
        { BASE_URL: 'https://staging.example.test/base/', APP_ENV: 'staging' },
        async () => {
          const adapter = createMcpAdapters({
            repoRoot,
            tools: {
              compileRequirement: async () => ({
                status: 'success',
                data: { auth: { state: 'unauthenticated' } },
              }),
              snapshotPage: async (args) => {
                captured = args;
                writeCatalog(repoRoot, args);
                return { status: 'success' };
              },
            },
          });
          await adapter.explore({ requirementPath: 'requirements/invoices.md' });
        },
      );
      expect(captured?.url).toBe('https://staging.example.test/base/');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('explicit role overrides the requirement default role', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let captured: Record<string, unknown> | undefined;

    try {
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapters = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'finance' },
              },
            }),
            snapshotPage: async (args) => {
              captured = args;
              writeCatalog(repoRoot, args);
              return { status: 'success' };
            },
          },
        });

        await adapters.explore({
          requirementPath: 'requirements/invoices.md',
          role: 'super-admin',
        });
      });

      expect(captured?.role).toBe('super-admin');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('re-captures a fresh role-scoped catalog after explicit force', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-explore-'));
    let snapshotArgs: Record<string, unknown> | undefined;
    try {
      const staleDir = path.join(repoRoot, 'artifacts', 'selector-catalog', 'invoices');
      fs.mkdirSync(staleDir, { recursive: true });
      fs.writeFileSync(
        path.join(staleDir, 'old.json'),
        JSON.stringify({ url: 'https://staging.example.test/invoices', role: 'finance' }),
      );
      await withEnv({ BASE_URL: 'https://staging.example.test', APP_ENV: 'staging' }, async () => {
        const adapter = createMcpAdapters({
          repoRoot,
          tools: {
            compileRequirement: async () => ({
              status: 'success',
              data: {
                startPage: '/invoices',
                auth: { state: 'authenticated', defaultRole: 'hrd' },
              },
            }),
            snapshotPage: async (args) => {
              snapshotArgs = args;
              writeCatalog(repoRoot, args);
              return { status: 'success' };
            },
          },
        });
        const result = await adapter.explore({
          requirementPath: 'requirements/invoices.md',
          force: true,
        });
        expect(result.evidence).toHaveLength(1);
      });
      expect(snapshotArgs).toMatchObject({ role: 'hrd', force: true, pageName: 'invoices-hrd' });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
