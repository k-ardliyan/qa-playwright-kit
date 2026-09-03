import * as fs from 'node:fs';
import { resolveAllowedPath } from '../utils/safety';
import {
  TEST_PLAN_SCHEMA_V1,
  type TestPlanContractV1,
  type PlanScenarioV1,
  type PlanAssertion,
  type AssertionProvenance,
  type PlanExecutionMode,
  type CoverageGap,
  type CatalogEvidence,
  type Diagnostic,
  createDiagnostic,
  computeSourceHash,
  type McpResult,
  failureResult,
} from '../contracts';
import { compileRequirementFromText } from './compile-requirement';
import { containsEphemeralRef } from '../utils/ephemeral-guard';

export interface CompileTestPlanArgs {
  testPlanPath?: unknown;
  testPlanText?: unknown;
  requirementPath?: unknown;
}

export type CompileTestPlanOutput = McpResult<TestPlanContractV1 | undefined>;

function parseAssertion(line: string): PlanAssertion {
  const clean = line.replace(/^\s*[-*\d.]+\s+/, '').trim();
  const tagMatch = clean.match(
    /^\[(requirement|live-verification|framework-derived|planner-assumption)\]\s*(.+)$/i,
  );

  if (tagMatch) {
    return {
      provenance: tagMatch[1].toLowerCase() as AssertionProvenance,
      description: tagMatch[2].trim(),
    };
  }

  // Fallback / default rule
  if (/^assert\s+url|header|cookie|toast|notification|button|status/i.test(clean)) {
    return {
      provenance: 'requirement',
      description: clean,
    };
  }

  return {
    provenance: 'planner-assumption',
    description: clean,
  };
}

export function compileTestPlanFromText(
  text: string,
  planPath?: string,
  explicitRequirementPath?: string,
): CompileTestPlanOutput {
  const diagnostics: Diagnostic[] = [];
  const planHash = computeSourceHash(text);

  // Metadata parsing
  let sourceRequirementPath = explicitRequirementPath ?? '';
  let sourceRequirementHash = '';
  let module = '';
  let feature = '';
  let seed: string | undefined;

  const reqPathMatch = text.match(
    /^\s*-\s+\*\*(?:Source\s+requirement|Requirement):\*\*\s*`?([^`\r\n]+)`?/im,
  );
  const parsedRequirementPath = reqPathMatch ? reqPathMatch[1].trim() : '';
  if (parsedRequirementPath) {
    sourceRequirementPath = parsedRequirementPath;
  }

  // GAP 5: Warn when explicitRequirementPath conflicts with the path parsed from the plan header
  if (
    explicitRequirementPath &&
    parsedRequirementPath &&
    explicitRequirementPath.replace(/\\/g, '/') !== parsedRequirementPath.replace(/\\/g, '/')
  ) {
    diagnostics.push(
      createDiagnostic(
        'PLAN_REQUIREMENT_PATH_MISMATCH',
        'warning',
        `Explicit requirementPath "${explicitRequirementPath}" differs from the path declared in the plan header "${parsedRequirementPath}". Using the plan header value for traceability.`,
      ),
    );
  }

  const reqHashMatch = text.match(
    /^\s*-\s+\*\*(?:Source\s+requirement\s+hash|Requirement\s+hash):\*\*\s*`?([^`\r\n]+)`?/im,
  );
  if (reqHashMatch) {
    sourceRequirementHash = reqHashMatch[1].trim();
  }

  const moduleMatch = text.match(/^\s*-\s+\*\*Module:\*\*\s*(.+)$/im);
  if (moduleMatch) {
    module = moduleMatch[1]
      .replace(/[`]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '');
  }

  const featMatch = text.match(/^\s*-\s+\*\*Feature:\*\*\s*(.+)$/im);
  if (featMatch) {
    feature = featMatch[1]
      .replace(/[`]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '')
      .replace(/\s+/g, '-');
  }

  const seedMatch = text.match(/^\s*-\s+\*\*Seed:\*\*\s*`?([^`\r\n]+)`?/im);
  if (seedMatch) {
    seed = seedMatch[1].trim();
  }

  // Resolve source requirement hash if path exists but hash was omitted
  if (sourceRequirementPath && !sourceRequirementHash) {
    const resolvedReq = resolveAllowedPath(sourceRequirementPath, 'requirements', {
      mustExist: false,
    });
    if (resolvedReq.ok && fs.existsSync(resolvedReq.absolutePath)) {
      try {
        const reqContent = fs.readFileSync(resolvedReq.absolutePath, 'utf-8');
        const compiledReq = compileRequirementFromText(reqContent, resolvedReq.relativePath);
        if (compiledReq.data) {
          sourceRequirementHash = compiledReq.data.sourceHash;
          if (!module) module = compiledReq.data.module ?? '';
          if (!feature) feature = compiledReq.data.feature ?? '';
        }
      } catch {
        // ignore
      }
    }
  }

  // Parse Catalog Evidence
  const catalogEvidence: CatalogEvidence[] = [];
  const catalogSectionMatch = text.match(
    /##+\s+(?:Catalog\s+Evidence|Selector\s+Catalog)([\s\S]*?)(?=##+|$)/i,
  );
  if (catalogSectionMatch) {
    const catLines = catalogSectionMatch[1].split('\n');
    for (const l of catLines) {
      const clean = l.replace(/^\s*[-*]\s+/, '').trim();
      if (!clean) continue;
      // Pattern: - **Page:** `page-slug` | `artifacts/selector-catalog/...`
      const match = clean.match(/^\*\*Page:\*\*\s*`?([^`|\r\n]+)`?\s*(?:\|\s*`?([^`\r\n]+)`?)?/i);
      if (match) {
        catalogEvidence.push({
          page: match[1].trim(),
          catalogPath: match[2]?.trim(),
        });
      }
    }
  }

  // Parse Coverage Gaps
  const coverageGaps: CoverageGap[] = [];
  const gapSectionMatch = text.match(/##+\s+(?:Coverage\s+Gaps?|Gaps?)([\s\S]*?)(?=##+|$)/i);
  if (gapSectionMatch) {
    const gapLines = gapSectionMatch[1].split('\n');
    for (const l of gapLines) {
      const clean = l.replace(/^\s*[-*]\s+/, '').trim();
      if (!clean) continue;
      // Pattern: - **Scenario:** `SC-05` | **AC:** `AC-06` | **Reason:** ...
      const scMatch = clean.match(/\*\*Scenario:\*\*\s*`?([^`|\r\n]+)`?/i);
      const acMatch = clean.match(/\*\*AC:\*\*\s*`?([^`|\r\n]+)`?/i);
      const reasonMatch = clean.match(/\*\*Reason:\*\*\s*(.+)$/i);

      if (scMatch || acMatch || reasonMatch) {
        coverageGaps.push({
          scenarioId: scMatch ? scMatch[1].trim() : undefined,
          acceptanceCriterionId: acMatch ? acMatch[1].trim() : undefined,
          reason: reasonMatch ? reasonMatch[1].trim() : clean,
        });
      }
    }
  }

  // Parse Plan Scenarios
  const scenarios: PlanScenarioV1[] = [];
  const scenarioBlocks = text.split(/(?=^###\s+)/m).filter((block) => /^###\s+/m.test(block));

  for (let idx = 0; idx < scenarioBlocks.length; idx++) {
    const block = scenarioBlocks[idx];
    const sLines = block.split('\n');
    const heading = sLines[0].replace(/^###\s+/, '').trim();

    const idMatch = heading.match(/^(SC-\d+)\s*:\s*(.+)$/i);
    const scenarioId = idMatch
      ? idMatch[1].toUpperCase()
      : `SC-${String(idx + 1).padStart(2, '0')}`;

    let testId: string | undefined;
    const covers: string[] = [];
    let actor: string | undefined;
    let authContext: string | undefined;
    let executionMode: PlanExecutionMode = 'automated';

    if (/@manual/i.test(heading)) executionMode = 'manual';
    else if (/@blocked/i.test(heading)) executionMode = 'blocked';

    const testIdMatch = block.match(/^\s*-\s+\*\*Test\s+ID:\*\*\s*`?([^`\r\n]+)`?/im);
    if (testIdMatch) testId = testIdMatch[1].trim();

    const coversMatch = block.match(/^\s*-\s+\*\*Covers:\*\*\s*(.+)$/im);
    if (coversMatch) {
      const tokens = coversMatch[1].replace(/[`]/g, '').split(/[,;]/);
      for (const tok of tokens) {
        const ac = tok.trim().toUpperCase();
        if (ac) covers.push(ac);
      }
    }

    const actorMatch = block.match(/^\s*-\s+\*\*Actor:\*\*\s*`?([^`\r\n]+)`?/im);
    if (actorMatch) actor = actorMatch[1].trim().toLowerCase();

    const authMatch = block.match(/^\s*-\s+\*\*Auth(?:\s+Context)?:\*\*\s*`?([^`\r\n]+)`?/im);
    if (authMatch) authContext = authMatch[1].trim().toLowerCase();

    const modeMatch = block.match(/^\s*-\s+\*\*Execution\s+Mode:\*\*\s*`?([^`\r\n]+)`?/im);
    if (modeMatch) {
      const raw = modeMatch[1].trim().toLowerCase();
      if (raw === 'manual' || raw === 'blocked' || raw === 'automated') {
        executionMode = raw;
      }
    }

    const dataSetup: string[] = [];
    const actions: string[] = [];
    const assertions: PlanAssertion[] = [];
    const locatorIntent: string[] = [];
    const networkExpectations: string[] = [];
    const artifactExpectations: string[] = [];
    const cleanup: string[] = [];
    const unknowns: string[] = [];

    let currentSection:
      | 'none'
      | 'setup'
      | 'actions'
      | 'assertions'
      | 'locators'
      | 'network'
      | 'artifacts'
      | 'cleanup'
      | 'unknowns' = 'none';

    for (let j = 1; j < sLines.length; j++) {
      const line = sLines[j];
      const trimmed = line.trim();

      if (/^\*\*(?:Data\s+Setup|Setup):\*\*/i.test(trimmed)) {
        currentSection = 'setup';
        continue;
      } else if (/^\*\*(?:Actions?|Langkah):\*\*/i.test(trimmed)) {
        currentSection = 'actions';
        continue;
      } else if (/^\*\*(?:Assertions?|Hasil(?:\s+yang)?\s+Diharapkan):\*\*/i.test(trimmed)) {
        currentSection = 'assertions';
        continue;
      } else if (/^\*\*(?:Locator\s+Intent|Locators?):\*\*/i.test(trimmed)) {
        currentSection = 'locators';
        continue;
      } else if (/^\*\*(?:Network\s+Expectations?|Network):\*\*/i.test(trimmed)) {
        currentSection = 'network';
        continue;
      } else if (/^\*\*(?:Artifact\s+Expectations?|Artifacts?):\*\*/i.test(trimmed)) {
        currentSection = 'artifacts';
        continue;
      } else if (/^\*\*(?:Cleanup|Teardown):\*\*/i.test(trimmed)) {
        currentSection = 'cleanup';
        continue;
      } else if (/^\*\*(?:Unknowns?):\*\*/i.test(trimmed)) {
        currentSection = 'unknowns';
        continue;
      } else if (/^\*\*[A-Z]/.test(trimmed) || /^###/.test(trimmed) || /^##/.test(trimmed)) {
        currentSection = 'none';
      }

      if (!trimmed) continue;

      const itemClean = trimmed.replace(/^\s*[-*\d.]+\s+/, '').trim();
      if (!itemClean || itemClean === 'none' || itemClean === '-') continue;

      // Check Ephemeral Browser Refs
      if (containsEphemeralRef(itemClean)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EPHEMERAL_REF',
            'error',
            `Scenario ${scenarioId} contains ephemeral browser runtime ref: "${itemClean}".`,
            { scenarioId },
          ),
        );
      }

      if (currentSection === 'setup') {
        dataSetup.push(itemClean);
      } else if (currentSection === 'actions') {
        actions.push(itemClean);
      } else if (currentSection === 'assertions') {
        assertions.push(parseAssertion(itemClean));
      } else if (currentSection === 'locators') {
        locatorIntent.push(itemClean);
      } else if (currentSection === 'network') {
        networkExpectations.push(itemClean);
      } else if (currentSection === 'artifacts') {
        artifactExpectations.push(itemClean);
      } else if (currentSection === 'cleanup') {
        cleanup.push(itemClean);
      } else if (currentSection === 'unknowns') {
        unknowns.push(itemClean);
      }
    }

    scenarios.push({
      scenarioId,
      testId,
      covers,
      actor,
      authContext,
      executionMode,
      dataSetup,
      actions,
      assertions,
      locatorIntent,
      networkExpectations,
      artifactExpectations,
      cleanup,
      unknowns,
    });
  }

  const contract: TestPlanContractV1 = {
    schemaVersion: TEST_PLAN_SCHEMA_V1,
    sourceRequirementPath,
    sourceRequirementHash,
    planPath,
    planHash,
    seed,
    module: module || undefined,
    feature: feature || undefined,
    catalogEvidence,
    scenarios,
    coverageGaps,
    diagnostics,
  };

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  if (errorCount > 0) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'error',
      data: contract,
      diagnostics,
      provenance: { sourcePath: planPath, sourceHash: planHash },
      message: `Compiled test plan from "${planPath ?? 'inline text'}" with ${errorCount} error(s).`,
    };
  }

  if (warningCount > 0) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'warning',
      data: contract,
      diagnostics,
      provenance: { sourcePath: planPath, sourceHash: planHash },
      message: `Compiled test plan from "${planPath ?? 'inline text'}" with ${warningCount} warning(s).`,
    };
  }

  return {
    schemaVersion: 'qa.mcp-result/v1',
    status: 'success',
    data: contract,
    diagnostics,
    provenance: { sourcePath: planPath, sourceHash: planHash },
    message: `Compiled test plan "${planPath ?? 'inline text'}" to ${TEST_PLAN_SCHEMA_V1} (${scenarios.length} scenarios planned).`,
  };
}

export function compileTestPlan(args: CompileTestPlanArgs | undefined): CompileTestPlanOutput {
  if (!args || typeof args !== 'object') {
    return failureResult([
      createDiagnostic(
        'INVALID_INPUT',
        'error',
        'Arguments must be an object with testPlanPath or testPlanText.',
      ),
    ]);
  }

  let text: string;
  let planPath: string | undefined;

  if (typeof args.testPlanText === 'string' && args.testPlanText.trim().length > 0) {
    text = args.testPlanText;
  } else if (typeof args.testPlanPath === 'string') {
    const resolved = resolveAllowedPath(args.testPlanPath, 'specs', { mustExist: true });
    if (!resolved.ok) {
      return failureResult([
        createDiagnostic(resolved.error.code, 'error', resolved.error.message, {
          path: args.testPlanPath,
        }),
      ]);
    }
    planPath = resolved.relativePath;
    text = fs.readFileSync(resolved.absolutePath, 'utf-8');
  } else {
    return failureResult([
      createDiagnostic('INVALID_INPUT', 'error', 'Provide `testPlanPath` or `testPlanText`.'),
    ]);
  }

  const explicitReqPath =
    typeof args.requirementPath === 'string' ? args.requirementPath : undefined;
  return compileTestPlanFromText(text, planPath, explicitReqPath);
}
