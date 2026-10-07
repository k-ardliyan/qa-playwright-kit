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
import { DOCTRINE_VERSION } from '../contracts/versions';
import { compileRequirementFromText } from './compile-requirement';
import { compileTestPlanFromText } from './compile-test-plan';
import { containsEphemeralReference } from '../utils/ephemeral-guard';
import {
  extractSeedRefs,
  knownSeedNames,
  loadSeedRegistry,
  type SeedRegistryFile,
} from '../utils/seed-registry';

export interface ValidatePlanOptions {
  /** Injected seed registry (unit tests) — `undefined` = load from the real
   *  `config/qa-kit.seeds.json`; `null` = explicitly none (checks stay silent). */
  seedRegistry?: SeedRegistryFile | null;
}

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
  /** Automated scenarios with no matching Catalog Evidence page (soft gaps). */
  evidenceGapsCount?: number;
  /** Automated scenarios WITH catalog evidence but an empty Locator Intent —
   * the catalog gives locators, the plan just never says which to drive. */
  locatorIntentGapsCount?: number;
  /** Scenarios depending on `seed:` refs while plan Metadata declares no Seed. */
  seedUnprovisionedCount?: number;
  /** Scenario `seed:` refs unknown to config/qa-kit.seeds.json (checked only
   *  when a registry exists AND Metadata declares a Seed). */
  seedUnknownCount?: number;
  /** Strict majority of automated scenarios lack catalog evidence — the plan is
   *  blocked (`PLAN_EVIDENCE_MAJORITY_GAP`), not merely warned. */
  majorityEvidenceGap?: boolean;
}

export type ValidatePlanOutput = McpResult<PlanValidationSummary | undefined>;

export function validateTestPlan(
  plan: TestPlanContractV1,
  requirement?: RequirementContractV1,
  options?: ValidatePlanOptions,
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

  // 2.5 Doctrine stamp: a plan STAMPED with an older doctrine predates the
  //     current planner/generator rules — flag it so the agent recompiles
  //     instead of trusting stale semantics. An ABSENT stamp means a pre-stamp
  //     plan: tolerated here, because its spec is already flagged by the
  //     missing-`// doctrine:` warning on the spec side. Warning only.
  if (plan.doctrine !== undefined && plan.doctrine !== DOCTRINE_VERSION) {
    diagnostics.push(
      createDiagnostic(
        'PLAN_DOCTRINE_STALE',
        'warning',
        `Plan doctrine stamp is "${plan.doctrine}" but the current doctrine is "${DOCTRINE_VERSION}" — this plan predates current planner/generator rules. Recompile the plan (compile_test_plan) to restamp it.`,
      ),
    );
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
      if (containsEphemeralReference(action)) {
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
      if (containsEphemeralReference(loc)) {
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

  // 5. Check Catalog Evidence freshness AND quality. Rule 0 promises the Planner
  //    that a captured page has elements and no auth warning; this enforces it,
  //    because a catalog captured without a session is not usable evidence.
  //    Every read is fail-safe: an unreadable/foreign file is skipped, never a
  //    crash and never a guessed warning.
  //
  //    A DECLARED-but-MISSING catalog is a different animal from a merely
  //    undesirable one: the plan asserts proof it does not have. That is the
  //    exact shape of the archived `tes-qa` plan (Catalog Evidence row pointing
  //    at a selector-catalog/ directory that does not exist, backing 37
  //    automated scenarios). It is an ERROR — but only when automated scenarios
  //    actually lean on it; a stale row in an all-manual plan stays a warning.
  const missingCatalogPages = new Set<string>();
  for (const cat of plan.catalogEvidence ?? []) {
    if (!cat.catalogPath) continue;
    const abs = path.resolve(mcpWorkspace.rootDir, cat.catalogPath);
    if (!fs.existsSync(abs)) {
      missingCatalogPages.add(cat.page);
      diagnostics.push(
        createDiagnostic(
          'NOT_FOUND',
          'warning',
          `Catalog evidence file not found at "${cat.catalogPath}".`,
        ),
      );
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as {
        elementCount?: number;
        warnings?: unknown;
      };
      if (typeof raw.elementCount === 'number' && raw.elementCount === 0) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EVIDENCE_EMPTY',
            'warning',
            `Catalog for page "${cat.page}" has 0 interactive elements — the snapshot captured nothing usable. Re-run snapshot_page for this page.`,
          ),
        );
      }
      if (Array.isArray(raw.warnings) && raw.warnings.length > 0) {
        diagnostics.push(
          createDiagnostic(
            'PLAN_EVIDENCE_UNVERIFIED',
            'warning',
            `Catalog for page "${cat.page}" was captured with warnings (${raw.warnings
              .map((w) => String(w))
              .join(
                '; ',
              )}) — the evidence is not verified. Re-login and re-snapshot before planning against it.`,
          ),
        );
      }
    } catch {
      // Unreadable or non-catalog JSON: not our call to judge — skip silently.
    }
  }

  // 6. Scenario → page evidence gate. An `automated` scenario must name a page
  //    that has a captured Catalog Evidence entry; without one the Generator has
  //    no locators to build from and the scenario ships as a silent
  //    `test.skip(true, 'not explored')` — unfinished work masquerading as
  //    "not applicable". Soft by design: the scenario is counted as an evidence
  //    gap (warning, not error), so the plan still validates and QA sees the
  //    real backlog instead of a fake green.
  const catalogPages = new Set(
    (plan.catalogEvidence ?? []).map((c) => c.page).filter((p): p is string => Boolean(p)),
  );
  const evidenceGapIds = new Set<string>();
  const locatorIntentGapIds = new Set<string>();
  let seedUnprovisionedCount = 0;
  let seedUnknownCount = 0;
  // Registry resolution: injected (unit tests) wins; otherwise load the real
  // per-project config/qa-kit.seeds.json. Missing/invalid → null (checks silent).
  const loadedSeedRegistry = loadSeedRegistry();
  const seedRegistry: SeedRegistryFile | null =
    options?.seedRegistry !== undefined
      ? options.seedRegistry
      : loadedSeedRegistry.ok
        ? loadedSeedRegistry.registry
        : null;
  // Naming the pages that DO exist makes the message actionable: the agent can
  // correct the row instead of guessing a name a second time.
  const availablePages = [...catalogPages].sort();
  const availableHint =
    availablePages.length > 0
      ? ` Available pages: ${availablePages.join(', ')}.`
      : ' No pages are catalogued for this feature yet — snapshot the page first.';
  for (const sc of plan.scenarios) {
    if (sc.executionMode !== 'automated') continue;
    const page = sc.page?.trim();
    if (!page) {
      evidenceGapIds.add(sc.scenarioId);
      diagnostics.push(
        createDiagnostic(
          'PLAN_EVIDENCE_MISSING',
          'warning',
          `Scenario ${sc.scenarioId} is automated but names no catalog page. Add a "Page" row matching a Catalog Evidence entry, or record it as a coverage gap.${availableHint}`,
          { scenarioId: sc.scenarioId },
        ),
      );
    } else if (!catalogPages.has(page)) {
      evidenceGapIds.add(sc.scenarioId);
      diagnostics.push(
        createDiagnostic(
          'PLAN_EVIDENCE_MISSING',
          'warning',
          `Scenario ${sc.scenarioId} references page "${page}", which has no Catalog Evidence entry. Snapshot the page first, or record the scenario as a coverage gap.${availableHint}`,
          { scenarioId: sc.scenarioId },
        ),
      );
    } else if (sc.locatorIntent.length === 0) {
      // Page evidence exists but the plan never says which elements to drive —
      // the tes-qa failure shape: one shallow catalog page "covered" 37
      // automated scenarios with `Locator Intent | none`, and the Generator
      // guessed (then skipped what it could not guess).
      locatorIntentGapIds.add(sc.scenarioId);
      diagnostics.push(
        createDiagnostic(
          'PLAN_LOCATOR_INTENT_MISSING',
          'warning',
          `Scenario ${sc.scenarioId} is automated against page "${page}" but has no Locator Intent. Draft locator intent from the selector catalog, or mark the scenario @not-implemented — an empty intent makes the Generator guess, and guesses ship as silent skips.`,
          { scenarioId: sc.scenarioId },
        ),
      );
    }
  }

  // 6.1 Blocking evidence gate. The per-scenario warnings above are deliberately
  //     soft so a plan with a FEW unexplored scenarios still validates (real
  //     backlog, not a fake green). But a plan where MOST automated scenarios
  //     have no evidence is not a plan with gaps — it is wholesale guessing, and
  //     letting it through is what produced the archived `tes-qa` run: 37/37
  //     automated scenarios with no catalog, which the Challenge gate then
  //     auto-approved in automatic mode and the Generator filled with
  //     `test.skip('UI belum dieksplorasi')`. Evidence per Barr et al., "The
  //     Oracle Problem" (IEEE TSE 2014) and CodeHalu (AAAI 2025): unverified
  //     output is not evidence. Threshold is a strict majority (>50%) over
  //     automated scenarios, and needs at least 2 of them so a brand-new
  //     single-scenario plan is never blocked for merely being small.
  const automatedScenarios = plan.scenarios.filter((sc) => sc.executionMode === 'automated');
  const EVIDENCE_MAJORITY_MIN_SCENARIOS = 2;
  const EVIDENCE_MAJORITY_THRESHOLD = 0.5;
  if (
    automatedScenarios.length >= EVIDENCE_MAJORITY_MIN_SCENARIOS &&
    evidenceGapIds.size / automatedScenarios.length > EVIDENCE_MAJORITY_THRESHOLD
  ) {
    const pct = Math.round((evidenceGapIds.size / automatedScenarios.length) * 100);
    diagnostics.push(
      createDiagnostic(
        'PLAN_EVIDENCE_MAJORITY_GAP',
        'error',
        `${evidenceGapIds.size} of ${automatedScenarios.length} automated scenario(s) (${pct}%) have no usable catalog evidence — the plan is mostly unverified. Explore the page(s) with snapshot_page/discover_pages and fill each scenario's Page + Locator Intent, or move the unbuilt scenarios to Coverage Gaps / mark them @not-implemented.${availableHint}`,
      ),
    );
  }

  // 6.2 Catalog evidence declared but absent on disk, while automated scenarios
  //     lean on it: the plan asserts proof it does not have. Blocking.
  if (missingCatalogPages.size > 0) {
    const dependentPages = new Set(
      automatedScenarios.map((sc) => sc.page?.trim()).filter((p): p is string => Boolean(p)),
    );
    const usedMissing = [...missingCatalogPages].filter((p) => dependentPages.has(p));
    if (usedMissing.length > 0) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_EVIDENCE_UNAVAILABLE',
          'error',
          `Catalog Evidence is declared for page(s) ${usedMissing
            .map((p) => `"${p}"`)
            .join(
              ', ',
            )} but the file is not on disk, and automated scenarios depend on it. Re-run snapshot_page for ${usedMissing.length > 1 ? 'these pages' : 'this page'} (or remove the stale Catalog Evidence row and the scenarios that lean on it).`,
        ),
      );
    }
  }

  // 6.5 Seed cross-check: a plan whose Metadata declares no Seed while its
  //     scenarios depend on `seed:` refs has no provisioning story — those
  //     preconditions cannot be met at run time, so the Generator either skips
  //     or silently passes. Soft warning; the fix is declaring the producer in
  //     Metadata or moving the scenarios to Coverage Gaps.
  const seedDeclared =
    typeof plan.seed === 'string' &&
    plan.seed.trim() !== '' &&
    !/^(-|none|n\/a|tidak ada)$/i.test(plan.seed.trim());
  if (!seedDeclared) {
    const seedPattern = /\bseed:\s*[a-z][\w.-]*/i;
    const seedScenarioIds = plan.scenarios
      .filter((sc) => sc.dataSetup.some((d) => seedPattern.test(d)))
      .map((sc) => sc.scenarioId);
    if (seedScenarioIds.length > 0) {
      const examples = seedScenarioIds.slice(0, 3).join(', ');
      const more = seedScenarioIds.length > 3 ? ` +${seedScenarioIds.length - 3} more` : '';
      diagnostics.push(
        createDiagnostic(
          'PLAN_SEED_UNPROVISIONED',
          'warning',
          `Plan Metadata declares no Seed, but ${seedScenarioIds.length} scenario(s) depend on seed: refs (${examples}${more}). Declare the seed producer in Metadata, or move those scenarios to Coverage Gaps — an unprovisioned seed ships as a skipped/silent-pass run.`,
        ),
      );
      seedUnprovisionedCount = seedScenarioIds.length;
    }
  }

  // 6.6 Seed registry cross-check — only when a registry EXISTS and Metadata
  //     declares a Seed: every seed:<name> ref in Data Setup must match a
  //     declared producer. Silent when no registry (existing workspaces get no
  //     new noise; PLAN_SEED_UNPROVISIONED above covers the Metadata-none case).
  if (seedDeclared && seedRegistry) {
    const known = new Set(knownSeedNames(seedRegistry));
    const unknownRefs = new Set<string>();
    for (const sc of plan.scenarios) {
      for (const ref of extractSeedRefs(sc.dataSetup.join('\n'))) {
        if (!known.has(ref)) unknownRefs.add(ref);
      }
    }
    if (unknownRefs.size > 0) {
      const unknownList = [...unknownRefs]
        .slice(0, 5)
        .map((r) => `seed:${r}`)
        .join(', ');
      const more = unknownRefs.size > 5 ? ` +${unknownRefs.size - 5} more` : '';
      const knownHint =
        known.size > 0
          ? ` Declared: ${[...known]
              .slice(0, 5)
              .map((r) => `seed:${r}`)
              .join(', ')}${known.size > 5 ? ' …' : ''}.`
          : ' The registry declares no seeds yet.';
      diagnostics.push(
        createDiagnostic(
          'PLAN_SEED_UNKNOWN',
          'warning',
          `Scenario Data Setup references seed(s) with no declared producer: ${unknownList}${more}.${knownHint} Add the producer to config/qa-kit.seeds.json (see list_seeds), or move the scenario to Coverage Gaps.`,
        ),
      );
      seedUnknownCount = unknownRefs.size;
    }
  }

  // 7. `not-implemented` scenarios must state WHY in coverage gaps — the status
  //    means "planned, not built yet", and an unexplained one is a silent drop.
  for (const sc of plan.scenarios) {
    if (sc.executionMode !== 'not-implemented') continue;
    if (!gapScenarioIds.has(sc.scenarioId)) {
      diagnostics.push(
        createDiagnostic(
          'PLAN_NOT_IMPLEMENTED_NO_GAP',
          'warning',
          `Scenario ${sc.scenarioId} is marked not-implemented but has no coverage gap entry. Record the reason (missing page, seed, dependency) in Coverage Gaps.`,
          { scenarioId: sc.scenarioId },
        ),
      );
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const valid = errorCount === 0;

  // A scenario that is BOTH recorded as a coverage gap AND missing evidence is
  // one gap, not two — the Planner already documented it. Count the union by
  // scenario id, plus any gap that carries no scenario id at all. Summing the
  // two collections double-counted those, and that inflated number feeds the
  // Challenge gate (a plan would report more gaps than it actually has).
  const gapIdsWithoutScenario = plan.coverageGaps.filter((g) => !g.scenarioId).length;
  const effectiveGapCount =
    new Set([...gapScenarioIds, ...evidenceGapIds]).size + gapIdsWithoutScenario;

  const summary: PlanValidationSummary = {
    valid,
    plannedScenarios: plan.scenarios.length,
    coveredAcs: coveredAcsCount,
    uncoveredAcs: uncoveredAcsCount,
    assumptionsCount,
    coverageGapsCount: effectiveGapCount,
    evidenceGapsCount: evidenceGapIds.size,
    locatorIntentGapsCount: locatorIntentGapIds.size,
    seedUnprovisionedCount,
    seedUnknownCount,
    majorityEvidenceGap:
      automatedScenarios.length >= EVIDENCE_MAJORITY_MIN_SCENARIOS &&
      evidenceGapIds.size / automatedScenarios.length > EVIDENCE_MAJORITY_THRESHOLD,
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

  const seedRegistry = loadSeedRegistry();
  return validateTestPlan(plan, requirement, {
    seedRegistry: seedRegistry.ok ? seedRegistry.registry : null,
  });
}
