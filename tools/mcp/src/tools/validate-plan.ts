import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAllowedPath } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';
import {
  TEST_PLAN_SCHEMA_V1,
  type TestPlanContractV1,
  type RequirementContractV1,
  type Diagnostic,
  createDiagnostic,
  type McpResult,
  failureResult,
} from '../contracts';
import { compileRequirementFromText } from './compile-requirement';
import { compileTestPlanFromText } from './compile-test-plan';
import { containsEphemeralRef } from '../utils/ephemeral-guard';

export interface ValidatePlanArgs {
  testPlan?: TestPlanContractV1 | unknown;
  testPlanPath?: string;
  requirement?: RequirementContractV1 | unknown;
  requirementPath?: string;
}

export interface PlanValidationSummary {
  valid: boolean;
  plannedScenarios: number;
  coveredAcs: number;
  uncoveredAcs: number;
  assumptionsCount: number;
  coverageGapsCount: number;
}

export type ValidatePlanOutput = McpResult<PlanValidationSummary | undefined>;

export function validateTestPlan(
  plan: TestPlanContractV1,
  requirement?: RequirementContractV1,
): ValidatePlanOutput {
  const diagnostics: Diagnostic[] = [...(plan.diagnostics ?? [])];

  // 1. Schema check
  if (plan.schemaVersion !== TEST_PLAN_SCHEMA_V1) {
    diagnostics.push(
      createDiagnostic(
        'CONTRACT_VERSION_UNSUPPORTED',
        'error',
        `Unsupported test plan schema version "${plan.schemaVersion}". Expected "${TEST_PLAN_SCHEMA_V1}".`,
      ),
    );
  }

  // 2. Requirement Hash check if requirement is provided
  if (requirement) {
    if (plan.sourceRequirementHash && plan.sourceRequirementHash !== requirement.sourceHash) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_STALE_REQUIREMENT',
          'error',
          `Test plan was generated from requirement hash "${plan.sourceRequirementHash.slice(0, 8)}" but current requirement hash is "${requirement.sourceHash.slice(0, 8)}".`,
        ),
      );
    }
  }

  const plannedScenariosMap = new Map(plan.scenarios.map((s) => [s.scenarioId, s]));
  const plannedCoveredAcs = new Set<string>();
  const reqAcIds = new Set(requirement?.acceptanceCriteria.map((a) => a.id) ?? []);

  // 3. Check Ephemeral Refs & Provenance across planned scenarios
  let assumptionsCount = 0;
  for (const sc of plan.scenarios) {
    for (const ac of sc.covers) {
      plannedCoveredAcs.add(ac);
      if (requirement && reqAcIds.size > 0 && !reqAcIds.has(ac)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_UNKNOWN_AC',
            'error',
            `Scenario ${sc.scenarioId} covers unknown acceptance criterion "${ac}".`,
            { scenarioId: sc.scenarioId },
          ),
        );
      }
    }

    // Check actions / locator intents for ephemeral refs
    for (const action of sc.actions) {
      if (containsEphemeralRef(action)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EPHEMERAL_REF_DETECTED',
            'error',
            `Scenario ${sc.scenarioId} contains ephemeral browser ref in action: "${action}"`,
            { scenarioId: sc.scenarioId },
          ),
        );
      }
    }
    for (const loc of sc.locatorIntent) {
      if (containsEphemeralRef(loc)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EPHEMERAL_REF_DETECTED',
            'error',
            `Scenario ${sc.scenarioId} contains ephemeral browser ref in locator intent: "${loc}"`,
            { scenarioId: sc.scenarioId },
          ),
        );
      }
    }

    // Check assertion provenance
    const validProvenances = new Set([
      'requirement',
      'live-verification',
      'framework-derived',
      'planner-assumption',
    ]);
    for (const ass of sc.assertions) {
      if (!validProvenances.has(ass.provenance)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_UNKNOWN_PROVENANCE',
            'error',
            `Scenario ${sc.scenarioId} contains unknown assertion provenance "${ass.provenance}". Allowed: requirement, live-verification, framework-derived, planner-assumption.`,
            { scenarioId: sc.scenarioId },
          ),
        );
      } else if (ass.provenance === 'planner-assumption') {
        assumptionsCount++;
        diagnostics.push(
          createDiagnostic(
            'PLAN_UNREVIEWED_ASSUMPTION',
            'warning',
            `Scenario ${sc.scenarioId} contains unreviewed planner assumption: "${ass.description}"`,
            { scenarioId: sc.scenarioId },
          ),
        );
      }
    }
  }

  // Check gaps
  const gapScenarioIds = new Set(
    plan.coverageGaps.map((g) => g.scenarioId).filter(Boolean) as string[],
  );
  const gapAcIds = new Set(
    plan.coverageGaps.map((g) => g.acceptanceCriterionId).filter(Boolean) as string[],
  );

  let uncoveredAcsCount = 0;
  const coveredAcsCount = plannedCoveredAcs.size;

  // 4. Bidirectional coverage checks with Requirement
  if (requirement) {
    // Check missing scenarios
    for (const reqSc of requirement.scenarios) {
      const isPlanned = plannedScenariosMap.has(reqSc.id);
      const isGap = gapScenarioIds.has(reqSc.id);

      if (!isPlanned && !isGap) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_SCENARIO_MISSING',
            'error',
            `Requirement scenario "${reqSc.id}: ${reqSc.title}" is missing from test plan and not recorded in coverage gaps.`,
            { scenarioId: reqSc.id },
          ),
        );
      }

      if (isPlanned) {
        const plannedSc = plannedScenariosMap.get(reqSc.id)!;
        // Check Role drift
        if (reqSc.actor && plannedSc.actor && reqSc.actor !== plannedSc.actor) {
          diagnostics.push(
            createDiagnostic(
              'PLAN_ROLE_DRIFT',
              'error',
              `Scenario ${reqSc.id} role drift: requirement specifies actor "${reqSc.actor}", plan specifies "${plannedSc.actor}".`,
              { scenarioId: reqSc.id },
            ),
          );
        }
        // Check Auth drift
        if (
          reqSc.authContext &&
          plannedSc.authContext &&
          reqSc.authContext !== plannedSc.authContext
        ) {
          diagnostics.push(
            createDiagnostic(
              'PLAN_AUTH_DRIFT',
              'error',
              `Scenario ${reqSc.id} auth drift: requirement specifies "${reqSc.authContext}", plan specifies "${plannedSc.authContext}".`,
              { scenarioId: reqSc.id },
            ),
          );
        }
        // Check Manual converted to automated without gap/review
        if (reqSc.type === 'manual' && plannedSc.executionMode === 'automated') {
          diagnostics.push(
            createDiagnostic(
              'PLAN_MANUAL_CONVERTED_WITHOUT_REASON',
              'warning',
              `Scenario ${reqSc.id} is marked @manual in requirement but automated in plan. Ensure automation capability is verified.`,
              { scenarioId: reqSc.id },
            ),
          );
        }
      }
    }

    // Check AC coverage
    for (const ac of requirement.acceptanceCriteria) {
      const isCovered = plannedCoveredAcs.has(ac.id);
      const isGap = gapAcIds.has(ac.id);

      if (!isCovered && !isGap) {
        uncoveredAcsCount++;
        diagnostics.push(
          createDiagnostic(
            'PLAN_AC_UNCOVERED',
            'error',
            `Acceptance criterion "${ac.id}: ${ac.description}" is not covered by any planned scenario and not listed in coverage gaps.`,
          ),
        );
      }
    }
  }

  // 5. Check Catalog Evidence freshness
  for (const cat of plan.catalogEvidence ?? []) {
    if (cat.catalogPath) {
      const abs = path.resolve(mcpWorkspace.rootDir, cat.catalogPath);
      if (!fs.existsSync(abs)) {
        diagnostics.push(
          createDiagnostic(
            'NOT_FOUND',
            'warning',
            `Catalog evidence file not found at "${cat.catalogPath}".`,
          ),
        );
      }
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const valid = errorCount === 0;

  const summary: PlanValidationSummary = {
    valid,
    plannedScenarios: plan.scenarios.length,
    coveredAcs: coveredAcsCount,
    uncoveredAcs: uncoveredAcsCount,
    assumptionsCount,
    coverageGapsCount: plan.coverageGaps.length,
  };

  if (!valid) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'error',
      data: summary,
      diagnostics,
      message: `Test plan validation failed with ${errorCount} error(s) and ${warningCount} warning(s).`,
    };
  }

  if (warningCount > 0) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'warning',
      data: summary,
      diagnostics,
      message: `Test plan validated with ${warningCount} warning(s).`,
    };
  }

  return {
    schemaVersion: 'qa.mcp-result/v1',
    status: 'success',
    data: summary,
    diagnostics,
    message: `Test plan passed all contract validation gates (${plan.scenarios.length} scenarios, ${coveredAcsCount} ACs covered).`,
  };
}

export function validatePlan(args: ValidatePlanArgs | undefined): ValidatePlanOutput {
  if (!args || typeof args !== 'object') {
    return failureResult([
      createDiagnostic('INVALID_INPUT', 'error', 'Arguments must be an object.'),
    ]);
  }

  let plan: TestPlanContractV1 | undefined;
  if (args.testPlan && typeof args.testPlan === 'object') {
    plan = args.testPlan as TestPlanContractV1;
  } else if (args.testPlanPath && typeof args.testPlanPath === 'string') {
    const resolved = resolveAllowedPath(args.testPlanPath, 'specs', { mustExist: true });
    if (!resolved.ok) {
      return failureResult([
        createDiagnostic(resolved.error.code, 'error', resolved.error.message, {
          path: args.testPlanPath,
        }),
      ]);
    }
    const raw = fs.readFileSync(resolved.absolutePath, 'utf-8');
    if (resolved.relativePath.endsWith('.md')) {
      const compiled = compileTestPlanFromText(raw, resolved.relativePath, args.requirementPath);
      if (compiled.data) {
        plan = compiled.data;
      } else {
        return failureResult(compiled.diagnostics, { message: compiled.message });
      }
    } else {
      try {
        plan = JSON.parse(raw) as TestPlanContractV1;
      } catch (err) {
        const compiled = compileTestPlanFromText(raw, resolved.relativePath, args.requirementPath);
        if (compiled.data) {
          plan = compiled.data;
        } else {
          return failureResult([
            createDiagnostic(
              'INVALID_INPUT',
              'error',
              `Failed to parse plan JSON or Markdown: ${err}`,
            ),
          ]);
        }
      }
    }
  }

  if (!plan) {
    return failureResult([
      createDiagnostic('INVALID_INPUT', 'error', 'Provide `testPlan` object or `testPlanPath`.'),
    ]);
  }

  let requirement: RequirementContractV1 | undefined;
  if (args.requirement && typeof args.requirement === 'object') {
    requirement = args.requirement as RequirementContractV1;
  } else if (args.requirementPath || plan.sourceRequirementPath) {
    const reqPath = args.requirementPath || plan.sourceRequirementPath;
    const resolved = resolveAllowedPath(reqPath, 'requirements', { mustExist: true });
    if (resolved.ok) {
      const text = fs.readFileSync(resolved.absolutePath, 'utf-8');
      const compiled = compileRequirementFromText(text, resolved.relativePath);
      if (compiled.data) {
        requirement = compiled.data;
      }
    }
  }

  return validateTestPlan(plan, requirement);
}
