/**
 * Unit tests for protocol edge cases — Agent AI Integration Layer
 *
 * Validates: Requirements 1.3, 1.7
 */

import { test, expect } from '@playwright/test';
import {
  validateRequest,
  createSuccessResponse,
  createErrorResponse,
  createInProgressResponse,
  VALID_PHASES,
} from '../protocol';
import { saveState, loadState, resumeState, archiveState, type PipelineState } from '../state';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_DEFINITIONS,
  getWorkflowStage,
  workflowStageForPhase,
  type PipelinePhase,
} from '../types';

test.describe('Protocol Validation — Capability Query (Req 1.3)', () => {
  test('capability query action validates without error', () => {
    const result = validateRequest({ action: 'query' });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.request.action).toBe('query');
      expect(result.request.options?.orchestrationMode).toBe('manual');
    }
  });
});

test.describe('Protocol Validation — Default Orchestration Mode (Req 1.7)', () => {
  test('default orchestration mode is "manual" when omitted', () => {
    const result = validateRequest({
      action: 'invoke',
      phase: 'plan',
      requirementPath: 'requirements/test.md',
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.request.options?.orchestrationMode).toBe('manual');
    }
  });

  test('explicit orchestration mode is preserved', () => {
    const result = validateRequest({
      action: 'invoke',
      phase: 'plan',
      requirementPath: 'requirements/test.md',
      options: { orchestrationMode: 'automatic' },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.request.options?.orchestrationMode).toBe('automatic');
    }
  });
});

test.describe('Protocol Validation — Invalid Phase Values', () => {
  test('invalid phase values return descriptive errors', () => {
    const result = validateRequest({
      action: 'invoke',
      phase: 'invalid-phase',
      requirementPath: 'requirements/test.md',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe('error');
      const errors = result.error.errors!;
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].code).toBe('INVALID_PHASE');
      // Error message should contain all valid phase names
      for (const phase of VALID_PHASES) {
        expect(errors[0].message).toContain(phase);
      }
    }
  });
});

test.describe('Protocol Validation — Schema Violations', () => {
  test('invoke without phase returns schema violation', () => {
    const result = validateRequest({
      action: 'invoke',
      requirementPath: 'requirements/test.md',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe('error');
      const errors = result.error.errors!;
      expect(errors.some((e) => e.message.toLowerCase().includes('phase'))).toBe(true);
    }
  });

  test('invoke without requirementPath returns schema violation', () => {
    const result = validateRequest({
      action: 'invoke',
      phase: 'plan',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe('error');
      const errors = result.error.errors!;
      expect(errors.some((e) => e.message.toLowerCase().includes('requirementpath'))).toBe(true);
    }
  });

  test('resume without options.runId returns schema violation', () => {
    const result = validateRequest({ action: 'resume' });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe('error');
      const errors = result.error.errors!;
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  test('resume with valid runId validates', () => {
    const result = validateRequest({
      action: 'resume',
      options: { runId: '550e8400-e29b-41d4-a716-446655440000' },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.request.action).toBe('resume');
      expect(result.request.options?.runId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  test('null request returns schema violation', () => {
    const result = validateRequest(null);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe('error');
      const errors = result.error.errors!;
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].code).toBe('SCHEMA_VIOLATION');
    }
  });
});

test.describe('Protocol hardening', () => {
  test('rejects scalar roleFilter and invalid option enums without throwing', () => {
    const result = validateRequest({
      action: 'run',
      requirementPath: 'requirements/test.md',
      options: { roleFilter: 'finance', orchestrationMode: 'sometimes' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.errors?.map((error) => error.code)).toEqual(
        expect.arrayContaining(['INVALID_ORCHESTRATION_MODE', 'SCHEMA_VIOLATION']),
      );
    }
  });

  test('rejects incompatible semantic and physical fields', () => {
    const result = validateRequest({
      action: 'run',
      phase: 'plan',
      requirementPath: 'requirements/test.md',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error.errors?.[0]?.code).toBe('INCOMPATIBLE_FIELD');
  });

  test('strictly validates paths, booleans, run IDs, and role filters without throwing', () => {
    const result = validateRequest({
      action: 'run',
      requirementPath: '../outside.txt',
      options: { resume: 'yes', dryRun: 'no', runId: '../bad', roleFilter: [42] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.errors?.map((error) => error.code)).toEqual(
        expect.arrayContaining(['INVALID_REQUIREMENT_PATH', 'SCHEMA_VIOLATION', 'INVALID_RUN_ID']),
      );
    }
  });

  test('rejects resume settings that could fork persisted run identity', () => {
    const result = validateRequest({
      action: 'resume',
      options: { runId: 'run-1', resume: true, orchestrationMode: 'automatic' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.error.errors?.filter((error) => error.code === 'INCOMPATIBLE_FIELD'),
      ).toHaveLength(2);
    }
  });
});

test.describe('Pipeline state hardening', () => {
  let reportDir: string;
  let previousReportDir: string | undefined;

  test.beforeEach(() => {
    previousReportDir = process.env['QA_REPORT_DIR'];
    reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-state-'));
    process.env['QA_REPORT_DIR'] = reportDir;
  });
  test.afterEach(() => {
    if (previousReportDir === undefined) delete process.env['QA_REPORT_DIR'];
    else process.env['QA_REPORT_DIR'] = previousReportDir;
    fs.rmSync(reportDir, { recursive: true, force: true });
  });

  function state(overrides: Partial<PipelineState> = {}): PipelineState {
    const timestamp = new Date().toISOString();
    return {
      runId: 'run-state-hardening',
      status: 'paused',
      currentPhase: null,
      completedPhases: [],
      artifacts: { plan: [], generate: [], execute: [], heal: [], report: [] },
      timestamp,
      startedAt: timestamp,
      requirementPath: 'requirements/auth/login-none.md',
      orchestrationMode: 'manual',
      errors: [],
      ...overrides,
    };
  }

  test('rejects malformed and non-prefix persisted phases', () => {
    const malformed = state({ completedPhases: ['generate'] as PipelineState['completedPhases'] });
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'pipeline-state.json'), JSON.stringify(malformed));
    expect(loadState()).toBeNull();
  });

  test('rejects traversal and refuses archive overwrite', () => {
    expect(() => archiveState(state({ runId: '../escape' }))).toThrow();
    archiveState(state());
    expect(() => archiveState(state())).toThrow(/Will not overwrite/);
  });

  test('hashed resume rejects missing requirement', () => {
    saveState(
      state({ requirementPath: 'requirements/missing-hardening.md', requirementHash: 'hash' }),
    );
    const result = resumeState();
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('missing');
  });
});

test.describe('Protocol Response Helpers', () => {
  test('response helpers produce correct structure', () => {
    const successResponse = createSuccessResponse('plan');
    expect(successResponse.status).toBe('success');
    expect(successResponse.phase).toBe('plan');

    const errorResponse = createErrorResponse([
      { code: 'TEST_ERROR', message: 'Something went wrong', retryable: false },
    ]);
    expect(errorResponse.status).toBe('error');
    expect(errorResponse.errors).toHaveLength(1);
    expect(errorResponse.errors![0].code).toBe('TEST_ERROR');

    const inProgressResponse = createInProgressResponse('generate');
    expect(inProgressResponse.status).toBe('in-progress');
    expect(inProgressResponse.phase).toBe('generate');
  });
});

test.describe('Semantic Workflow Stages (Explore–Model–Challenge–Generate–Validate)', () => {
  test('defines exactly 5 ordered semantic stages', () => {
    expect(WORKFLOW_STAGES).toEqual(['explore', 'model', 'challenge', 'generate', 'validate']);
    expect(WORKFLOW_STAGES).toHaveLength(5);
  });

  test('all five descriptors exist with exact labels and activities', () => {
    for (const stage of WORKFLOW_STAGES) {
      const def = WORKFLOW_STAGE_DEFINITIONS[stage];
      expect(def).toBeDefined();
      expect(def.stage).toBe(stage);
      expect(def.subCategory.length).toBeGreaterThan(0);
      expect(def.activities.length).toBeGreaterThanOrEqual(4);
      expect(def.statusLabel.length).toBeGreaterThan(0);
    }

    expect(WORKFLOW_STAGE_DEFINITIONS.explore.statusLabel).toBe('THE APP ANSWERS');
    expect(WORKFLOW_STAGE_DEFINITIONS.model.statusLabel).toBe('SHARED MODEL');
    expect(WORKFLOW_STAGE_DEFINITIONS.challenge.statusLabel).toBe('THE GATE');
    expect(WORKFLOW_STAGE_DEFINITIONS.generate.statusLabel).toBe('FOURTH, NOT FIRST');
    expect(WORKFLOW_STAGE_DEFINITIONS.validate.statusLabel).toBe('EARNED TRUST');

    expect(WORKFLOW_STAGE_DEFINITIONS.validate.notes).toContain('Execute');
    expect(WORKFLOW_STAGE_DEFINITIONS.validate.notes).toContain('Heal');
    expect(WORKFLOW_STAGE_DEFINITIONS.validate.notes).toContain('Report(Analyze)');
  });

  test('every physical phase is represented across semantic stage mappings', () => {
    const allPhysicalPhases = new Set<PipelinePhase>();
    for (const stage of WORKFLOW_STAGES) {
      for (const p of WORKFLOW_STAGE_DEFINITIONS[stage].physicalPhases) {
        allPhysicalPhases.add(p);
      }
    }
    for (const p of VALID_PHASES) {
      expect(allPhysicalPhases.has(p)).toBe(true);
    }
  });

  test('getWorkflowStage lookup returns descriptor or undefined for unknown', () => {
    expect(getWorkflowStage('explore')?.statusLabel).toBe('THE APP ANSWERS');
    expect(getWorkflowStage('model')?.statusLabel).toBe('SHARED MODEL');
    expect(getWorkflowStage('challenge')?.statusLabel).toBe('THE GATE');
    expect(getWorkflowStage('generate')?.statusLabel).toBe('FOURTH, NOT FIRST');
    expect(getWorkflowStage('validate')?.statusLabel).toBe('EARNED TRUST');
    expect(getWorkflowStage('unknown-stage')).toBeUndefined();
  });

  test('workflowStageForPhase maps physical phases correctly', () => {
    expect(workflowStageForPhase('plan')).toBe('model');
    expect(workflowStageForPhase('generate')).toBe('generate');
    expect(workflowStageForPhase('execute')).toBe('validate');
    expect(workflowStageForPhase('heal')).toBe('validate');
    expect(workflowStageForPhase('report')).toBe('validate');
  });
});
