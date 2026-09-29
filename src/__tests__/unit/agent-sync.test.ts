import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncAgentSkillsAndMcp, detectInstalledClients } from '@/setup/agent-sync';

test.describe('syncAgentSkillsAndMcp', () => {
  let tempRepo: string;

  test.beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-test-'));
  });

  test.afterEach(() => {
    if (fs.existsSync(tempRepo)) {
      fs.rmSync(tempRepo, { recursive: true, force: true });
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
});
