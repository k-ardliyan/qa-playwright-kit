import {
  type RequirementScenarioV1,
  type AcceptanceCriterion,
  type AccessMatrixEntry,
  type RequirementInputData,
  type InputDataSource,
  type ScenarioType,
  type Diagnostic,
  createDiagnostic,
} from '../../contracts';

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  return value.trim();
}

export function parseTitleAndId(lines: string[]): { title: string; id: string } {
  const h1 = lines.find((line) => /^\s*#\s+/.test(line) && !/^\s*##/.test(line));
  let title = 'Untitled Requirement';
  let id = 'REQ-UNTITLED-001';

  if (h1) {
    const raw = h1.replace(/^\s*#\s+/, '').trim();
    // Pattern: # REQ-AUTH-001: User Login
    const match = raw.match(/^(REQ-[A-Z0-9_-]+)\s*:\s*(.+)$/i);
    if (match) {
      id = match[1].toUpperCase();
      title = match[2].trim();
    } else {
      title = raw;
      const idMatch = raw.match(/REQ-[A-Z0-9_-]+/i);
      if (idMatch) {
        id = idMatch[0].toUpperCase();
      }
    }
  }

  const explicitId = lines.find((line) => /^\s*id\s*:/i.test(line));
  if (explicitId) {
    const customId = explicitId.replace(/^\s*id\s*:/i, '').trim();
    if (customId) id = customId.toUpperCase();
  }

  return { title, id };
}

export function parseMetadata(
  text: string,
  lines: string[],
  requirementPath?: string,
): {
  module: string;
  feature: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  risk: string[];
  tags: string[];
  authState: 'authenticated' | 'unauthenticated';
  defaultRole?: string;
  startPage?: string;
  roles: string[];
  environmentScope: string[];
  dataScope: string[];
} {
  let module = '';
  let feature = '';
  let priority: 'low' | 'medium' | 'high' | 'critical' | undefined;
  const risk: string[] = [];
  const tags: string[] = [];
  let authState: 'authenticated' | 'unauthenticated' = 'authenticated';
  let defaultRole: string | undefined;
  let startPage: string | undefined;
  const roles: string[] = [];
  const environmentScope: string[] = [];
  const dataScope: string[] = [];

  // Match Module
  const modMatch = text.match(/^\s*-\s+\*\*Module:\*\*\s*(.+)$/im);
  if (modMatch) {
    module = modMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '');
  } else if (requirementPath) {
    const normalized = requirementPath.replace(/\\/g, '/');
    const folderMatch = normalized.match(/^requirements\/([^/]+)\/.+\.md$/i);
    if (folderMatch && !folderMatch[1].startsWith('_') && folderMatch[1] !== 'readme') {
      module = folderMatch[1].toLowerCase();
    }
  }
  if (!module) module = 'general';

  // Match Feature
  const featMatch = text.match(/^\s*-\s+\*\*Feature:\*\*\s*(.+)$/im);
  if (featMatch) {
    feature = featMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[.,;]+$/, '')
      .replace(/\s+/g, '-');
  } else if (requirementPath) {
    const filename = requirementPath.replace(/\\/g, '/').split('/').pop() ?? '';
    const stem = filename.replace(/\.md$/i, '').toLowerCase().replace(/\s+/g, '-');
    if (stem && !stem.startsWith('_') && stem !== 'readme') {
      feature = stem;
    }
  }
  if (!feature) feature = 'general';

  // Priority
  const prioMatch = text.match(/^\s*-\s+\*\*(?:Prioritas|Priority):\*\*\s*(.+)$/im);
  if (prioMatch) {
    const raw = prioMatch[1].trim().toLowerCase();
    if (['low', 'medium', 'high', 'critical'].includes(raw)) {
      priority = raw as 'low' | 'medium' | 'high' | 'critical';
    }
  }

  // Tags
  const tagMatch = text.match(/^\s*-\s+\*\*Tags:\*\*\s*(.+)$/im);
  if (tagMatch) {
    const tokens = tagMatch[1].split(/[\s,]+/);
    for (const t of tokens) {
      const clean = t.trim().replace(/^#/, '').toLowerCase();
      if (clean) tags.push(clean);
    }
  }

  // Auth state
  const authMatch = text.match(/^\s*-\s+\*\*Auth(?:\s+state)?:\*\*\s*(.+)$/im);
  if (authMatch) {
    const raw = authMatch[1].trim().toLowerCase();
    if (raw.includes('unauth') || raw.includes('public') || raw === 'none') {
      authState = 'unauthenticated';
    } else {
      authState = 'authenticated';
    }
  }

  // Start page
  const pageMatch = text.match(/^\s*-\s+\*\*(?:Halaman\s+awal|Start\s+page):\*\*\s*(.+)$/im);
  if (pageMatch) {
    startPage = pageMatch[1].trim();
  }

  // Default role
  const defRoleMatch = text.match(/^\s*-\s+\*\*Default\s+role:\*\*\s*(.+)$/im);
  if (defRoleMatch) {
    defaultRole = defRoleMatch[1].trim().toLowerCase();
  }

  // Role scope
  const roleScopeMatch = text.match(/^\s*-\s+\*\*Role\s+scope:\*\*\s*(.+)$/im);
  if (roleScopeMatch) {
    const parts = roleScopeMatch[1].split(/[,;]/);
    for (const p of parts) {
      const clean = p
        .trim()
        .toLowerCase()
        .replace(/[.,;]+$/, '');
      if (clean && clean !== 'general' && clean !== 'default' && !roles.includes(clean)) {
        roles.push(clean);
      }
    }
  }

  // Risk
  const riskMatch = text.match(/^\s*-\s+\*\*Risk:\*\*\s*(.+)$/im);
  if (riskMatch) {
    risk.push(riskMatch[1].trim());
  }

  return {
    module,
    feature,
    priority,
    risk,
    tags,
    authState,
    defaultRole,
    startPage,
    roles,
    environmentScope,
    dataScope,
  };
}

export function parseAccessMatrix(
  text: string,
  rolesInScope: string[],
): {
  matrix: AccessMatrixEntry[];
  diagnostics: Diagnostic[];
} {
  const matrix: AccessMatrixEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  // Check for markdown table: | Role | Access | Expectation |
  const lines = text.split('\n');
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##+\s+(?:Access\s+Matrix|Matriks\s+Akses)/i.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^##+/.test(line)) {
      break;
    }
    if (inTable && line.startsWith('|') && line.endsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length >= 3) {
        const role = cells[0].toLowerCase();
        if (role === 'role' || role === '---' || role.includes('---')) continue;
        const accessRaw = cells[1].toLowerCase();
        const access: 'allow' | 'deny' | 'conditional' =
          accessRaw === 'deny' || accessRaw === 'block' || accessRaw === 'forbidden'
            ? 'deny'
            : accessRaw === 'conditional'
              ? 'conditional'
              : 'allow';
        const expectation = cells[2];
        matrix.push({ role, access, expectation });
      }
    }
  }

  // Fallback: Check for prose "Access expectation:" in metadata
  if (matrix.length === 0) {
    const proseMatch = text.match(/^\s*-\s+\*\*Access\s+expectation:\*\*\s*(.+)$/im);
    if (proseMatch) {
      diagnostics.push(
        createDiagnostic(
          'REQ_LEGACY_ROLE_PROSE',
          'info',
          'Access expectation authored as prose. Using markdown Access Matrix table is recommended.',
        ),
      );
      const prose = proseMatch[1].trim();
      for (const role of rolesInScope) {
        matrix.push({
          role,
          access:
            prose.toLowerCase().includes('cannot') || prose.toLowerCase().includes('deny')
              ? 'deny'
              : 'allow',
          expectation: prose,
        });
      }
    }
  }

  return { matrix, diagnostics };
}

export function parseAcceptanceCriteria(text: string): {
  criteria: AcceptanceCriterion[];
  diagnostics: Diagnostic[];
} {
  const criteria: AcceptanceCriterion[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = text.split('\n');
  let inAcSection = false;
  let counter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##+\s+(?:Kriteria\s+Penerimaan|Acceptance\s+Criteria)/i.test(line)) {
      inAcSection = true;
      continue;
    }
    if (inAcSection && /^##+/.test(line)) {
      break;
    }
    if (inAcSection && /^\s*[-*]\s+/.test(line)) {
      const content = line.replace(/^\s*[-*]\s+/, '').trim();
      // Match explicit AC ID: - **AC-01:** User can ...
      const explicitMatch = content.match(/^\*\*(AC-\d+):\*\*\s*(.+)$/i);
      if (explicitMatch) {
        criteria.push({
          id: explicitMatch[1].toUpperCase(),
          description: explicitMatch[2].trim(),
        });
      } else {
        // Legacy bullet without ID
        const generatedId = `AC-${String(counter).padStart(2, '0')}`;
        counter++;
        criteria.push({
          id: generatedId,
          description: content,
        });
        diagnostics.push(
          createDiagnostic(
            'REQ_LEGACY_AC_BULLET',
            'warning',
            `Acceptance criterion authored without explicit ID. Assigned "${generatedId}".`,
            { suggestion: `Use "- **${generatedId}:** ${content}"` },
          ),
        );
      }
    }
  }

  return { criteria, diagnostics };
}

export function parseInputData(rawLines: string[]): RequirementInputData[] {
  const result: RequirementInputData[] = [];
  for (const line of rawLines) {
    const clean = line.replace(/^\s*[-*\d.]+\s+/, '').trim();
    if (!clean || clean.toLowerCase() === 'none' || clean.toLowerCase() === '-') continue;

    // Pattern: key: source:value or key: value
    const match = clean.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();

      const sourcePrefixes: Array<[string, InputDataSource]> = [
        ['credential:', 'credential'],
        ['fixture:', 'fixture'],
        ['seed:', 'seed'],
        ['generated:', 'generated'],
        ['literal:', 'literal'],
      ];

      let detectedSource: InputDataSource = 'literal';
      let cleanVal = val;

      for (const [prefix, src] of sourcePrefixes) {
        if (val.toLowerCase().startsWith(prefix)) {
          detectedSource = src;
          cleanVal = val.slice(prefix.length).trim();
          break;
        }
      }

      result.push({
        key,
        source: detectedSource,
        value: cleanVal,
        ref: detectedSource !== 'literal' ? cleanVal : undefined,
      });
    } else {
      result.push({
        key: 'input',
        source: 'literal',
        value: clean,
      });
    }
  }
  return result;
}

export function parseScenarios(
  text: string,
  declaredAcIds: Set<string>,
): {
  scenarios: RequirementScenarioV1[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const parsedList: RequirementScenarioV1[] = [];

  const scenarioBlocks = text.split(/(?=^###\s+)/m).filter((block) => /^###\s+/m.test(block));

  for (let idx = 0; idx < scenarioBlocks.length; idx++) {
    const block = scenarioBlocks[idx];
    const lines = block.split('\n');
    const headingLine = lines[0].replace(/^###\s+/, '').trim();

    // Extract ID and Title from heading
    // ### SC-01: Finance approve invoice (@success @network-assert)
    const idMatch = headingLine.match(/^(SC-\d+)\s*:\s*(.+)$/i);
    const scenarioId = idMatch
      ? idMatch[1].toUpperCase()
      : `SC-${String(idx + 1).padStart(2, '0')}`;
    const rawTitle = idMatch ? idMatch[2].trim() : headingLine;

    const isManual = /@manual/i.test(headingLine);
    const scenarioType: ScenarioType = isManual
      ? 'manual'
      : /@failure/i.test(headingLine)
        ? 'failure'
        : /@access-restriction/i.test(headingLine)
          ? 'access-restriction'
          : /@success/i.test(headingLine)
            ? 'success'
            : 'general';

    const cleanTitle = rawTitle.replace(/\s*\(@[^)]+\)\s*/g, ' ').trim();

    // Extract capabilities from tags in heading
    const capabilities: string[] = [];
    const tagMatches = headingLine.match(/@([\w-]+)/g);
    if (tagMatches) {
      for (const t of tagMatches) {
        const tag = t.replace(/^@/, '').toLowerCase();
        if (!['manual', 'success', 'failure', 'access-restriction'].includes(tag)) {
          capabilities.push(tag);
        }
      }
    }

    // Extract fields within scenario block
    let testId: string | undefined;
    const covers: string[] = [];
    let actor: string | undefined;
    let scenarioPriority: 'low' | 'medium' | 'high' | 'critical' | undefined;
    const affectedLayers: string[] = [];
    const preconditions: string[] = [];
    const inputDataLines: string[] = [];
    const steps: string[] = [];
    const expectations: string[] = [];

    // Parse Test ID
    const testIdMatch = block.match(/^\s*-\s+\*\*Test\s+ID:\*\*\s*`?([^`\r\n]+)`?/im);
    if (testIdMatch) {
      testId = testIdMatch[1].trim();
    }

    // Parse Covers
    const coversMatch = block.match(/^\s*-\s+\*\*Covers:\*\*\s*(.+)$/im);
    if (coversMatch) {
      const tokens = coversMatch[1].replace(/[`]/g, '').split(/[,;]/);
      for (const tok of tokens) {
        const ac = tok.trim().toUpperCase();
        if (ac) covers.push(ac);
      }
    }

    // Parse Actor
    const actorMatch = block.match(/^\s*-\s+\*\*Actor:\*\*\s*`?([^`\r\n]+)`?/im);
    if (actorMatch) {
      actor = actorMatch[1].trim().toLowerCase();
    } else {
      // Fallback: check heading prefix "Finance:"
      const prefixMatch = cleanTitle.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
      if (
        prefixMatch &&
        ['super-admin', 'finance', 'hrd', 'admin', 'user'].includes(prefixMatch[1].toLowerCase())
      ) {
        actor = prefixMatch[1].toLowerCase();
      }
    }

    // Parse scenario priority
    const prioMatch = block.match(
      /^\s*-\s+\*\*(?:Prioritas\s+skenario|Scenario\s+priority):\*\*\s*`?([^`\r\n]+)`?/im,
    );
    if (prioMatch) {
      const raw = prioMatch[1].trim().toLowerCase();
      if (['low', 'medium', 'high', 'critical'].includes(raw)) {
        scenarioPriority = raw as 'low' | 'medium' | 'high' | 'critical';
      }
    }

    // Parse affected layers
    const layerMatch = block.match(
      /^\s*-\s+\*\*(?:Layer\s+terdampak|Affected\s+layers?):\*\*\s*(.+)$/im,
    );
    if (layerMatch) {
      const tokens = layerMatch[1].replace(/[`]/g, '').split(/[\s,]+/);
      for (const tok of tokens) {
        const l = tok.trim().toUpperCase();
        if (['FE', 'BE', 'DB', 'API'].includes(l)) {
          affectedLayers.push(l);
        }
      }
    }

    // Section parser: Prekondisi, Input Data, Langkah, Hasil
    let currentSection: 'none' | 'precondition' | 'input' | 'steps' | 'expectations' = 'none';

    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trim();

      if (/^\*\*(?:Prekondisi|Preconditions?|Given):\*\*/i.test(trimmed)) {
        currentSection = 'precondition';
        continue;
      } else if (/^\*\*(?:Input\s+Data):\*\*/i.test(trimmed)) {
        currentSection = 'input';
        continue;
      } else if (/^\*\*(?:Langkah|Steps?):\*\*/i.test(trimmed)) {
        currentSection = 'steps';
        continue;
      } else if (
        /^\*\*(?:Hasil\s+(?:yang\s+)?Diharapkan|Expected\s+Results?|Outcome):\*\*/i.test(trimmed)
      ) {
        currentSection = 'expectations';
        continue;
      } else if (/^\*\*[A-Z]/.test(trimmed) || /^###/.test(trimmed)) {
        currentSection = 'none';
      }

      if (!trimmed) continue;

      if (currentSection === 'precondition') {
        preconditions.push(trimmed.replace(/^\s*[-*\d.]+\s+/, ''));
      } else if (currentSection === 'input') {
        inputDataLines.push(trimmed);
      } else if (currentSection === 'steps') {
        steps.push(trimmed.replace(/^\s*[-*\d.]+\s+/, ''));
      } else if (currentSection === 'expectations') {
        expectations.push(trimmed.replace(/^\s*[-*\d.]+\s+/, ''));
      }
    }

    // Validate Covers
    if (covers.length === 0 && declaredAcIds.size > 0) {
      diagnostics.push(
        createDiagnostic(
          'REQ_UNKNOWN_AC_REFERENCE',
          'warning',
          `Scenario ${scenarioId} does not declare explicit Covers field.`,
          { scenarioId },
        ),
      );
    } else {
      for (const ac of covers) {
        if (!declaredAcIds.has(ac)) {
          diagnostics.push(
            createDiagnostic(
              'REQ_UNKNOWN_AC_REFERENCE',
              'error',
              `Scenario ${scenarioId} references unknown AC "${ac}".`,
              { scenarioId },
            ),
          );
        }
      }
    }

    if (expectations.length === 0) {
      diagnostics.push(
        createDiagnostic(
          'REQ_NO_OBSERVABLE_RESULT',
          'error',
          `Scenario ${scenarioId} has no observable expected results.`,
          { scenarioId },
        ),
      );
    }

    parsedList.push({
      id: scenarioId,
      testId,
      title: cleanTitle,
      type: scenarioType,
      priority: scenarioPriority,
      actor,
      capabilities,
      affectedLayers,
      covers,
      preconditions,
      inputData: parseInputData(inputDataLines),
      steps,
      expectations,
      automation: {
        automatable: !isManual,
        reason: isManual ? 'Tagged with @manual' : undefined,
      },
    });
  }

  return { scenarios: parsedList, diagnostics };
}
