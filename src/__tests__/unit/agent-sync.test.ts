import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncAgentSkillsAndMcp } from '@/setup/agent-sync';

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

  test('synchronizes skills and references to .agents/skills and .claude/skills', () => {
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

    const result = syncAgentSkillsAndMcp(tempRepo);

    expect(result.skillsSynced).toContain('test-skill');
    expect(result.mcpConfigsGenerated).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Verify .agents/skills copy
    const targetSkillMd = path.join(tempRepo, '.agents', 'skills', 'test-skill', 'SKILL.md');
    const targetRefMd = path.join(
      tempRepo,
      '.agents',
      'skills',
      'test-skill',
      'references',
      'ref.md',
    );
    expect(fs.existsSync(targetSkillMd)).toBe(true);
    expect(fs.readFileSync(targetSkillMd, 'utf-8')).toBe('# Test Skill Content');
    expect(fs.existsSync(targetRefMd)).toBe(true);

    // Verify .claude/skills copy
    const claudeSkillMd = path.join(tempRepo, '.claude', 'skills', 'test-skill', 'SKILL.md');
    expect(fs.existsSync(claudeSkillMd)).toBe(true);

    // Verify Hermes skills detection property exists on result (null in headless CI without Hermes base, string locally)
    expect('hermesProfileSkillsDir' in result).toBe(true);

    // Verify MCP generated configs (.cursor/mcp.json, etc.)
    const cursorMcp = path.join(tempRepo, '.cursor', 'mcp.json');
    expect(fs.existsSync(cursorMcp)).toBe(true);
  });

  test('resolves active Hermes profile skills dir when hermes base exists', () => {
    const origEnv = process.env.LOCALAPPDATA;
    try {
      process.env.LOCALAPPDATA = tempRepo;
      // create <tempRepo>/hermes/active_profile
      const hermesDir = path.join(tempRepo, 'hermes');
      fs.mkdirSync(path.join(hermesDir, 'profiles', 'custom-qa', 'skills'), { recursive: true });
      fs.writeFileSync(path.join(hermesDir, 'active_profile'), 'custom-qa', 'utf8');

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveHermesActiveSkillsDir } = require('@/setup/agent-sync');
      const resolved = resolveHermesActiveSkillsDir();
      expect(resolved).toContain('custom-qa');
    } finally {
      process.env.LOCALAPPDATA = origEnv;
    }
  });
});
