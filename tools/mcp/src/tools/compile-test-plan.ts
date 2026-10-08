import * as fs from 'node:fs';
import { resolveAllowedPath } from '../utils/safety';
import {
  TEST_PLAN_SCHEMA_V1,
  type TestPlanContractV1,
  type PlanScenarioV1,
  type PlanAssertion,
  type AssertionProvenance,
  type PlanExecutionMode,
  type ScenarioEvidenceMode,
  type PlanDataOperation,
  type PlanDataSetupV1,
  type PlanDataTargetV1,
  type PlanRelationV1,
  type CoverageGap,
  type CatalogEvidence,
  type Diagnostic,
  createDiagnostic,
  computeSourceHash,
  DOCTRINE_VERSION,
  type McpResult,
  failureResult,
} from '../contracts';
import { compileRequirementFromText } from './compile-requirement';
import { containsEphemeralReference } from '../utils/ephemeral-guard';
import { readLabel, readLabelFromSection, splitRow } from './parsers/md-labels';

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

  const parsedRequirementPath = readLabel(text, 'Source requirement', 'Requirement') ?? '';
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

  const reqHashRaw = readLabel(text, 'Source requirement hash', 'Requirement hash');
  if (reqHashRaw) {
    sourceRequirementHash = reqHashRaw;
  }

  const moduleRaw = readLabel(text, 'Module');
  if (moduleRaw) {
    module = moduleRaw
      .replace(/[`]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '');
  }

  const featRaw = readLabel(text, 'Feature');
  if (featRaw) {
    feature = featRaw
      .replace(/[`]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '')
      .replace(/\s+/g, '-');
  }

  const seedRaw = readLabel(text, 'Seed');
  if (seedRaw) {
    seed = seedRaw;
  }

  // Doctrine stamp: which agent-instruction version produced this plan. When
  // the Metadata row is absent, stamp the CURRENT version — the plan is being
  // compiled by this engine right now. An explicit row that drifts from the
  // current doctrine is what validate_plan's PLAN_DOCTRINE_STALE flags.
  const doctrineRaw = readLabel(text, 'Doctrine');
  const doctrine = doctrineRaw ?? DOCTRINE_VERSION;

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

  // Parse Catalog Evidence. Two shapes must parse: the canonical template
  // (specs/_TEMPLATE.md) writes a `| Page | Catalog |` table, while older plans
  // use the bullet form. A bullet-only reader silently produced an EMPTY
  // evidence list for template-shaped plans, which made the downstream evidence
  // gate warn on every automated scenario — a false positive on the kit's own
  // documented format.
  const catalogEvidence: CatalogEvidence[] = [];
  const catalogSectionMatch = text.match(
    /##+\s+(?:Catalog\s+Evidence|Selector\s+Catalog)([\s\S]*?)(?=##+|$)/i,
  );
  if (catalogSectionMatch) {
    const catLines = catalogSectionMatch[1].split('\n');
    for (const l of catLines) {
      const trimmed = l.trim();
      if (!trimmed) continue;

      // Pattern B (table row): | `login-form` | `artifacts/selector-catalog/...` |
      if (/^\|.*\|$/.test(trimmed)) {
        const cells = splitRow(trimmed);
        const page = (cells[0] ?? '').trim();
        // Skip the header row and the `| --- | --- |` separator.
        if (!page || /^(page|halaman)$/i.test(page) || /^[-:]+$/.test(page)) continue;
        catalogEvidence.push({
          page,
          catalogPath: (cells[1] ?? '').trim() || undefined,
        });
        continue;
      }

      const clean = trimmed.replace(/^\s*[-*]\s+/, '').trim();
      if (!clean) continue;
      // Pattern A (bullet): - **Page:** `page-slug` | `artifacts/selector-catalog/...`
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
      // Pattern A (bullet): - **Scenario:** `SC-05` | **AC:** `AC-06` | **Reason:** ...
      const scMatch = clean.match(/\*\*Scenario:\*\*\s*`?([^`|\r\n]+)`?/i);
      const acMatch = clean.match(/\*\*AC:\*\*\s*`?([^`|\r\n]+)`?/i);
      const reasonMatch = clean.match(/\*\*Reason:\*\*\s*(.+)$/i);
      if (scMatch || acMatch || reasonMatch) {
        coverageGaps.push({
          scenarioId: scMatch ? scMatch[1].trim() : undefined,
          acceptanceCriterionId: acMatch ? acMatch[1].trim() : undefined,
          reason: reasonMatch ? reasonMatch[1].trim() : clean,
        });
        continue;
      }
      // Pattern B (table row): | `SC-05` | `AC-06` | reason text |
      const cells = splitRow(clean);
      if (cells.length >= 3 && /^\|.*\|$/.test(clean)) {
        if (/^(scenario|skenario)$/i.test(cells[0]) || /^[-:]+$/.test(cells[0])) continue;
        coverageGaps.push({
          scenarioId: cells[0].replace(/`/g, '').trim() || undefined,
          acceptanceCriterionId: cells[1].replace(/`/g, '').trim() || undefined,
          reason: cells[2].trim(),
        });
      }
    }
  }

  // Parse Plan Scenarios
  const scenarios: PlanScenarioV1[] = [];

  // ## Data Targets — | Entity | Operations | Covers |
  const planDataTargets: PlanDataTargetV1[] = [];
  const targetSection = text.match(/##+\s+(?:Data\s+Targets?|Target\s+Data)([\s\S]*?)(?=##+|$)/i);
  if (targetSection) {
    for (const line of targetSection[1].split('\n')) {
      const trimmed = line.trim();
      if (!/^\|.*\|$/.test(trimmed)) continue;
      const cells = splitRow(trimmed);
      const entity = (cells[0] ?? '').toLowerCase();
      if (!entity || entity === 'entity' || /^[-:]+$/.test(entity)) continue;
      const operations = (cells[1] ?? '')
        .toLowerCase()
        .split(/[,\s]+/)
        .map((op) => op.trim())
        .filter((op): op is PlanDataOperation =>
          ['create', 'read', 'update', 'delete', 'transition'].includes(op),
        );
      const covers = (cells[2] ?? '')
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      planDataTargets.push({
        entity,
        operations,
        ...(covers.length > 0 ? { covers } : {}),
      });
    }
  }

  // ## Relationships — | Parent | Child | Confidence | Scenario | Seed |
  const planRelations: PlanRelationV1[] = [];
  const relationSection = text.match(/##+\s+(?:Relationships?|Relasi)([\s\S]*?)(?=##+|$)/i);
  if (relationSection) {
    for (const line of relationSection[1].split('\n')) {
      const trimmed = line.trim();
      if (!/^\|.*\|$/.test(trimmed)) continue;
      const cells = splitRow(trimmed);
      const parent = (cells[0] ?? '').toLowerCase();
      const child = (cells[1] ?? '').toLowerCase();
      if (!parent || !child || parent === 'parent' || /^[-:]+$/.test(parent)) continue;
      const confidence =
        (cells[2] ?? '').toLowerCase() === 'confirmed' ? 'confirmed' : 'assumption';
      const scenarioId = (cells[3] ?? '').toUpperCase() || undefined;
      const seedRef = (cells[4] ?? '').replace(/^seed:\s*/i, '').trim() || undefined;
      planRelations.push({
        parent,
        child,
        confidence,
        ...(scenarioId ? { scenarioId } : {}),
        ...(seedRef ? { seedRef } : {}),
      });
    }
  }
  const scenarioBlocks = text.split(/(?=^###\s+)/m).filter((block) => /^###\s+/m.test(block));

  for (let idx = 0; idx < scenarioBlocks.length; idx++) {
    const block = scenarioBlocks[idx];
    const sLines = block.split('\n');
    const heading = sLines[0].replace(/^###\s+/, '').trim();

    const idMatch = heading.match(/^(SC-\d+)\s*:\s*(.+)$/i);
    const scenarioId = idMatch
      ? idMatch[1].toUpperCase()
      : `SC-${String(idx + 1).padStart(2, '0')}`;

    let actor: string | undefined;
    let authContext: string | undefined;
    let executionMode: PlanExecutionMode = 'automated';
    let evidenceMode: ScenarioEvidenceMode = 'ui-e2e';

    if (/@manual/i.test(heading)) executionMode = 'manual';
    else if (/@not-implemented/i.test(heading)) executionMode = 'not-implemented';
    else if (/@blocked/i.test(heading)) executionMode = 'blocked';

    const testId = readLabel(block, 'Test ID') ?? undefined;
    // Catalog page this scenario exercises; matched against Catalog Evidence so
    // a scenario cannot claim `automated` without a captured page behind it.
    const page = readLabel(block, 'Page') ?? undefined;

    const covers: string[] = [];
    const coversRaw = readLabel(block, 'Covers');
    if (coversRaw) {
      // Space- AND comma-separated — see requirement-parsers.ts (same cell
      // convention; the comma-only split turned `AC-01` `AC-02` into one bogus id).
      const tokens = coversRaw.replace(/[`]/g, '').split(/[,;\s]+/);
      for (const tok of tokens) {
        const ac = tok.trim().toUpperCase();
        if (ac) covers.push(ac);
      }
    }

    const actorRaw = readLabel(block, 'Actor');
    if (actorRaw) actor = actorRaw.toLowerCase();

    const authRaw = readLabel(block, 'Auth Context', 'Auth');
    if (authRaw) authContext = authRaw.toLowerCase();

    const evidenceModeRaw = readLabel(block, 'Evidence Mode');
    if (evidenceModeRaw) {
      const raw = evidenceModeRaw.toLowerCase();
      if (raw === 'ui-e2e' || raw === 'hybrid-ui') evidenceMode = raw;
      else {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EVIDENCE_MODE_INVALID',
            'error',
            `Scenario ${scenarioId} has unsupported Evidence Mode "${evidenceModeRaw}". Use ui-e2e or hybrid-ui.`,
            { scenarioId },
          ),
        );
      }
    }
    if (evidenceMode === 'hybrid-ui' && !/@hybrid\b/i.test(heading)) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_HYBRID_TAG_MISSING',
          'error',
          `Scenario ${scenarioId} declares Evidence Mode hybrid-ui but is missing the @hybrid capability tag.`,
          { scenarioId },
        ),
      );
    }
    if (/@hybrid\b/i.test(heading) && evidenceMode !== 'hybrid-ui') {
      diagnostics.push(
        createDiagnostic(
          'PLAN_HYBRID_MODE_MISSING',
          'error',
          `Scenario ${scenarioId} uses @hybrid but does not declare Evidence Mode hybrid-ui.`,
          { scenarioId },
        ),
      );
    }

    const modeRaw = readLabel(block, 'Execution Mode');
    if (modeRaw) {
      const raw = modeRaw.toLowerCase();
      if (
        raw === 'manual' ||
        raw === 'blocked' ||
        raw === 'automated' ||
        raw === 'not-implemented'
      ) {
        executionMode = raw;
      }
    }

    const assertions: PlanAssertion[] = [];

    // Section content: bullet form (label + items below) or table form (`| Label | a<br>b |`).
    // The ephemeral-ref check below still runs over every item — it is a gate, not formatting.
    const dataSetup = readLabelFromSection(block, ['Data Setup', 'Setup']);
    const actions = readLabelFromSection(block, ['Actions', 'Langkah']);
    const assertionLines = readLabelFromSection(block, ['Assertions', 'Hasil yang Diharapkan']);
    const locatorIntent = readLabelFromSection(block, ['Locator Intent', 'Locators']);
    const networkExpectations = readLabelFromSection(block, ['Network Expectations', 'Network']);
    const artifactExpectations = readLabelFromSection(block, [
      'Artifact Expectations',
      'Artifacts',
    ]);
    const cleanup = readLabelFromSection(block, ['Cleanup', 'Teardown']);
    const unknowns = readLabelFromSection(block, ['Unknowns']);

    // Typed data setup: seeds + entity/operation + asserted relation. Kept
    // alongside the free-text `dataSetup` so legacy plans keep parsing.
    const planSeeds = [
      ...new Set(
        dataSetup.flatMap((item) =>
          (item.match(/\bseed:\s*([a-z][\w.-]*)/gi) ?? []).map((m) =>
            m.replace(/^seed:\s*/i, '').trim(),
          ),
        ),
      ),
    ];
    const planOperationRaw = (
      readLabel(block, 'Data Operation', 'Operasi Data') ?? ''
    ).toLowerCase();
    const planOperation = ['create', 'read', 'update', 'delete', 'transition'].includes(
      planOperationRaw,
    )
      ? (planOperationRaw as PlanDataOperation)
      : undefined;
    const planEntity = readLabel(block, 'Data Entity', 'Entitas Data') ?? undefined;
    const planAssertsRelation = readLabel(block, 'Asserts Relation', 'Relasi Diuji') ?? undefined;
    const dataSetupTyped: PlanDataSetupV1 | undefined =
      planSeeds.length > 0 || planEntity || planOperation || planAssertsRelation
        ? {
            seeds: planSeeds,
            ...(planEntity ? { entity: planEntity } : {}),
            ...(planOperation ? { operation: planOperation } : {}),
            ...(planAssertsRelation ? { assertsRelation: planAssertsRelation } : {}),
          }
        : undefined;

    if (
      evidenceMode === 'hybrid-ui' &&
      !dataSetup.some((item) => /\bseed:\s*[a-z][\w.-]*/i.test(item))
    ) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_HYBRID_SETUP_MISSING',
          'error',
          `Scenario ${scenarioId} declares hybrid-ui but has no seed:<name> producer in Data Setup. Declare a registered producer or move the scenario to Coverage Gaps.`,
          { scenarioId },
        ),
      );
    }
    if (
      evidenceMode === 'hybrid-ui' &&
      !cleanup.some((item) => /\b(?:apiCleanup|test-owned|residual data acceptable)/i.test(item))
    ) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_HYBRID_CLEANUP_MISSING',
          'error',
          `Scenario ${scenarioId} declares hybrid-ui but has no explicit safe Cleanup policy. Use apiCleanup for test-owned IDs or state that residual data is acceptable.`,
          { scenarioId },
        ),
      );
    }

    for (const itemClean of [
      ...dataSetup,
      ...actions,
      ...assertionLines,
      ...locatorIntent,
      ...networkExpectations,
      ...artifactExpectations,
      ...cleanup,
      ...unknowns,
    ]) {
      // Check Ephemeral Browser Refs
      if (containsEphemeralReference(itemClean)) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EPHEMERAL_REF',
            'error',
            `Scenario ${scenarioId} contains ephemeral browser runtime ref: "${itemClean}".`,
            { scenarioId },
          ),
        );
      }
    }

    // Assertions carry a provenance tag; parse them from the collected lines.
    for (const itemClean of assertionLines) {
      assertions.push(parseAssertion(itemClean));
    }

    scenarios.push({
      scenarioId,
      testId,
      covers,
      actor,
      authContext,
      page,
      executionMode,
      evidenceMode,
      dataSetup,
      ...(dataSetupTyped ? { dataSetupTyped } : {}),
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
    doctrine,
    module: module || undefined,
    feature: feature || undefined,
    ...(planDataTargets.length > 0 ? { dataTargets: planDataTargets } : {}),
    ...(planRelations.length > 0 ? { relations: planRelations } : {}),
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
