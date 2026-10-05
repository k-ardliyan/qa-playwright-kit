import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  syncAgentSkillsAndMcp,
  detectInstalledClients,
  detectHermesInstall,
  hermesTrustCommand,
  hermesBaseDir,
  type TrustRunner,
} from '@/setup/agent-sync';

/** Records trust calls and succeeds, so tests never spawn the real `hermes`. */
function fakeTrust(trusted = true): TrustRunner & { calls: string[] } {
  const calls: string[] = [];
  const runner = ((repoRoot: string) => {
    calls.push(repoRoot);
    return { trusted };
  }) as TrustRunner & { calls: string[] };
  runner.calls = calls;
  return runner;
}

test.describe('syncAgentSkillsAndMcp', () => {
  let tempRepo: string;
  let tempHome: string;
  let origLocalAppData: string | undefined;

  test.beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
    // Isolate the Hermes install probe too: detectHermesInstall() reads
    // LOCALAPPDATA, so without this the suite would consult the real ~/.hermes.
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-localappdata-'));
    origLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tempHome;
  });

  test.afterEach(() => {
    if (origLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = origLocalAppData;
    }
    for (const dir of [tempRepo, tempHome]) {
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('generates MCP configs only for clients detected on this machine', () => {
    // Setup fake skills source
    const skillDir = path.join(tempRepo, 'skills', 'test-skill');
    const refDir = path.join(skillDir, 'references');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill Content', 'utf-8');
    fs.writeFileSync(path.join(refDir, 'ref.md'), '# Ref Content', 'utf-8');

    // Setup fake .mcp.json source
    const mcpJson = {
      servers: [
        {
          name: 'test-server',
          command: 'node',
          args: ['index.js'],
        },
      ],
    };
    fs.writeFileSync(path.join(tempRepo, '.mcp.json'), JSON.stringify(mcpJson), 'utf-8');

    // Fake home with only cursor + claude installed
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-home-'));
    fs.mkdirSync(path.join(fakeHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });

    try {
      const result = syncAgentSkillsAndMcp(tempRepo, fakeHome, fakeTrust());

      expect(result.skillsSynced).toContain('test-skill');
      expect(result.mcpPlatforms.sort()).toEqual(['claude', 'cursor']);
      expect(result.errors).toHaveLength(0);

      // Verify .agents/skills copy
      const targetSkillMd = path.join(tempRepo, '.agents', 'skills', 'test-skill', 'SKILL.md');
      expect(fs.existsSync(targetSkillMd)).toBe(true);
      expect(fs.readFileSync(targetSkillMd, 'utf-8')).toBe('# Test Skill Content');
      expect(
        fs.existsSync(
          path.join(tempRepo, '.agents', 'skills', 'test-skill', 'references', 'ref.md'),
        ),
      ).toBe(true);

      // Claude installed → .claude/skills copy exists
      expect(
        fs.existsSync(path.join(tempRepo, '.claude', 'skills', 'test-skill', 'SKILL.md')),
      ).toBe(true);

      // Cursor installed → config generated; kiro/codex NOT installed → nothing
      expect(fs.existsSync(path.join(tempRepo, '.cursor', 'mcp.json'))).toBe(true);
      expect(fs.existsSync(path.join(tempRepo, '.kiro', 'mcp.json'))).toBe(false);
      expect(fs.existsSync(path.join(tempRepo, '.codex', 'config.toml'))).toBe(false);
      expect(fs.existsSync(path.join(tempRepo, 'claude_desktop_config.json'))).toBe(true);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test('no client installed: no MCP configs, no .claude/skills orphan', () => {
    fs.mkdirSync(path.join(tempRepo, 'skills', 'test-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'test-skill', 'SKILL.md'), '# x', 'utf-8');
    fs.writeFileSync(
      path.join(tempRepo, '.mcp.json'),
      JSON.stringify({ servers: [{ name: 's', command: 'node', args: [] }] }),
      'utf-8',
    );

    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-empty-home-'));
    try {
      const result = syncAgentSkillsAndMcp(tempRepo, emptyHome, fakeTrust());

      expect(result.mcpPlatforms).toEqual([]);
      expect(result.errors).toHaveLength(0);
      expect(fs.existsSync(path.join(tempRepo, '.claude'))).toBe(false);
      expect(fs.existsSync(path.join(tempRepo, '.cursor'))).toBe(false);
      expect(fs.existsSync(path.join(tempRepo, '.agents', 'skills', 'test-skill'))).toBe(true);
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  test('detectInstalledClients maps home markers to platforms', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-detect-'));
    try {
      expect(detectInstalledClients(home)).toEqual([]);
      fs.mkdirSync(path.join(home, '.kiro'));
      fs.mkdirSync(path.join(home, '.codex'));
      expect(detectInstalledClients(home).sort()).toEqual(['codex', 'kiro']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('never writes into the Hermes profile skills dir', () => {
    // The profile skills dir is where Hermes learns (agent-authored skills +
    // curator state). The sync must never create or touch it — that is the whole
    // point of trusting the repo instead of copying.
    const hermesSkills = path.join(tempHome, 'hermes', 'skills');
    fs.mkdirSync(path.join(hermesSkills, 'learned-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(hermesSkills, 'learned-skill', 'SKILL.md'),
      '# Hermes own lesson',
      'utf-8',
    );

    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');

    syncAgentSkillsAndMcp(tempRepo, tempHome, fakeTrust());

    // The lesson survives byte-for-byte, and no framework copy is planted beside it.
    expect(fs.readFileSync(path.join(hermesSkills, 'learned-skill', 'SKILL.md'), 'utf-8')).toBe(
      '# Hermes own lesson',
    );
    expect(fs.existsSync(path.join(hermesSkills, 'framework-skill'))).toBe(false);
    expect(fs.existsSync(path.join(hermesSkills, 'qa-playwright-kit'))).toBe(false);
  });

  test('trusts the repo when Hermes is installed, with the exact command', () => {
    fs.mkdirSync(path.join(tempHome, 'hermes'), { recursive: true });
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');

    const trust = fakeTrust(true);
    const result = syncAgentSkillsAndMcp(tempRepo, tempHome, trust);

    expect(result.hermesDetected).toBe(true);
    expect(result.hermesTrusted).toBe(true);
    expect(trust.calls).toEqual([tempRepo]);
    expect(result.hermesTrustCommand).toBe(`hermes skills trust ${tempRepo}`);
  });

  test('reports the manual command when automatic trust fails', () => {
    fs.mkdirSync(path.join(tempHome, 'hermes'), { recursive: true });
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');

    const result = syncAgentSkillsAndMcp(tempRepo, tempHome, fakeTrust(false));

    expect(result.hermesDetected).toBe(true);
    expect(result.hermesTrusted).toBe(false);
    // Soft-fail: still a reported command, never an abort.
    expect(result.hermesTrustCommand).toContain('hermes skills trust');
  });

  test('skips the trust step entirely when Hermes is absent', () => {
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');

    const trust = fakeTrust(true);
    const result = syncAgentSkillsAndMcp(tempRepo, tempHome, trust);

    expect(result.hermesDetected).toBe(false);
    expect(result.hermesTrusted).toBe(false);
    expect(trust.calls).toEqual([]);
  });

  test('mirror replaces stale files instead of merging', () => {
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');
    const stale = path.join(
      tempRepo,
      '.agents',
      'skills',
      'framework-skill',
      'deleted-upstream.md',
    );
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '# gone upstream', 'utf-8');

    syncAgentSkillsAndMcp(tempRepo, tempHome, fakeTrust());

    expect(fs.existsSync(stale)).toBe(false);
  });

  test('hermesTrustCommand and hermesBaseDir resolve per platform', () => {
    expect(hermesTrustCommand('/tmp/repo')).toBe('hermes skills trust /tmp/repo');
    expect(hermesBaseDir(tempHome)).toBe(path.join(tempHome, 'hermes'));
    // With LOCALAPPDATA set (as in the fixture), the base dir follows it.
    expect(hermesBaseDir('/somewhere/else')).toBe(path.join(tempHome, 'hermes'));
  });

  test('detectHermesInstall is true only when the Hermes base dir exists', () => {
    expect(detectHermesInstall(tempHome)).toBe(false);
    fs.mkdirSync(path.join(tempHome, 'hermes'), { recursive: true });
    expect(detectHermesInstall(tempHome)).toBe(true);
  });
});
