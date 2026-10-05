import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  syncAgentSkillsAndMcp,
  detectInstalledClients,
  LEARNED_SKILLS_DIR,
} from '@/setup/agent-sync';

test.describe('syncAgentSkillsAndMcp', () => {
  let tempRepo: string;
  let tempHome: string;
  let origLocalAppData: string | undefined;

  test.beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
    // Isolate the Hermes target too: resolveHermesActiveSkillsDir() reads
    // LOCALAPPDATA, so without this the sync writes test skills into the real
    // ~/.hermes/skills of whoever runs the suite.
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
      const result = syncAgentSkillsAndMcp(tempRepo, fakeHome);

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

      // Verify Hermes skills detection property exists on result
      expect('hermesProfileSkillsDir' in result).toBe(true);
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
      const result = syncAgentSkillsAndMcp(tempRepo, emptyHome);

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

  test('resolves active Hermes profile skills dir when hermes base exists', () => {
    const origEnv = process.env.LOCALAPPDATA;
    try {
      process.env.LOCALAPPDATA = tempRepo;
      // create <tempRepo>/hermes/active_profile
      const hermesDir = path.join(tempRepo, 'hermes');
      fs.mkdirSync(path.join(hermesDir, 'profiles', 'custom-qa', 'skills'), { recursive: true });
      fs.writeFileSync(path.join(hermesDir, 'active_profile'), 'custom-qa', 'utf8');

      const { resolveHermesActiveSkillsDir } = require('@/setup/agent-sync');
      const resolved = resolveHermesActiveSkillsDir();
      expect(resolved).toContain('custom-qa');
    } finally {
      process.env.LOCALAPPDATA = origEnv;
    }
  });

  test('mirrors .learned-skills/*-learned next to the framework pack', () => {
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');
    fs.mkdirSync(path.join(tempRepo, LEARNED_SKILLS_DIR, 'framework-skill-learned'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempRepo, LEARNED_SKILLS_DIR, 'framework-skill-learned', 'SKILL.md'),
      '# Learned',
      'utf-8',
    );

    const result = syncAgentSkillsAndMcp(tempRepo, os.homedir());

    expect(result.skillsSynced).toEqual(['framework-skill']);
    expect(result.learnedSkillsSynced).toEqual(['framework-skill-learned']);
    const learned = path.join(tempRepo, '.agents', 'skills', 'framework-skill-learned', 'SKILL.md');
    expect(fs.readFileSync(learned, 'utf-8')).toBe('# Learned');
  });

  test('a learned skill cannot shadow a framework skill name', () => {
    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');
    // Same name as the framework skill → refused, framework copy wins.
    fs.mkdirSync(path.join(tempRepo, LEARNED_SKILLS_DIR, 'framework-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, LEARNED_SKILLS_DIR, 'framework-skill', 'SKILL.md'),
      '# Shadow attempt',
      'utf-8',
    );
    // Wrong suffix → refused too.
    fs.mkdirSync(path.join(tempRepo, LEARNED_SKILLS_DIR, 'no-suffix'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, LEARNED_SKILLS_DIR, 'no-suffix', 'SKILL.md'),
      '# x',
      'utf-8',
    );

    const result = syncAgentSkillsAndMcp(tempRepo, os.homedir());

    expect(result.learnedSkillsSynced).toEqual([]);
    expect(result.errors).toHaveLength(2);
    const synced = path.join(tempRepo, '.agents', 'skills', 'framework-skill', 'SKILL.md');
    expect(fs.readFileSync(synced, 'utf-8')).toBe('# F');
    expect(fs.existsSync(path.join(tempRepo, '.agents', 'skills', 'no-suffix'))).toBe(false);
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

    syncAgentSkillsAndMcp(tempRepo, os.homedir());

    expect(fs.existsSync(stale)).toBe(false);
  });

  test('never prunes unrelated skills out of the Hermes profile skills dir', () => {
    // The Hermes profile skills dir is shared with Hermes' own install: bundled
    // skills, .hub/ state, .usage.json. A root-level wipe there would destroy it.
    process.env.LOCALAPPDATA = tempRepo;
    const hermesSkills = path.join(tempRepo, 'hermes', 'skills');
    fs.mkdirSync(path.join(hermesSkills, 'bundled-hermes-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(hermesSkills, 'bundled-hermes-skill', 'SKILL.md'),
      '# Hermes own',
      'utf-8',
    );
    fs.writeFileSync(path.join(hermesSkills, '.usage.json'), '{}', 'utf-8');

    fs.mkdirSync(path.join(tempRepo, 'skills', 'framework-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'skills', 'framework-skill', 'SKILL.md'), '# F', 'utf-8');

    syncAgentSkillsAndMcp(tempRepo, os.homedir());

    expect(
      fs.readFileSync(path.join(hermesSkills, 'bundled-hermes-skill', 'SKILL.md'), 'utf-8'),
    ).toBe('# Hermes own');
    expect(fs.existsSync(path.join(hermesSkills, '.usage.json'))).toBe(true);
    expect(fs.existsSync(path.join(hermesSkills, 'framework-skill', 'SKILL.md'))).toBe(true);
  });

  test('learnedSkillNameError enforces suffix and collision rules', () => {
    const { learnedSkillNameError } = require('@/setup/agent-sync');
    expect(learnedSkillNameError('kit-learned', ['kit'])).toBeNull();
    expect(learnedSkillNameError('kit', ['kit'])).toContain('-learned');
    expect(learnedSkillNameError('kit-learned', ['kit-learned'])).toContain('collides');
  });
});
