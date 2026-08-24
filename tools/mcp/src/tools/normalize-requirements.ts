import * as fs from 'node:fs';
import { assertRequirementsTextSize, resolveAllowedPath } from '../utils/safety';
import { logger } from '../utils/logger';
import {
  parseRequirementScenariosFromText,
  type RequirementScenario,
} from './parse-requirement-scenarios';

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface RequirementMetadata {
  tags: string[];
  priority?: string;
  authState?: 'unauthenticated' | 'authenticated';
  startPage?: string;
  pomFixtures?: string[];
}

export interface RequirementsContract {
  id: string;
  title: string;
  acceptanceCriteria: AcceptanceCriterion[];
  scenarios?: RequirementScenario[];
  tags: string[];
  metadata?: RequirementMetadata;
}

export interface NormalizeRequirementsOutput {
  contract?: RequirementsContract;
  status: 'success' | 'error';
  error?: {
    code: string;
    message: string;
  };
}

function toStableId(input: string): string {
  const normalized = input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return normalized.length > 0 ? `REQ-${normalized}` : 'REQ-UNTITLED';
}

function parseTitle(lines: string[]): string | null {
  const markdownHeading = lines.find((line) => /^\s*#\s+/.test(line) && !/^\s*##/.test(line));
  if (markdownHeading) {
    return markdownHeading.replace(/^\s*#\s+/, '').trim();
  }

  const explicitTitle = lines.find((line) => /^\s*title\s*:/i.test(line));
  if (explicitTitle) {
    return explicitTitle.replace(/^\s*title\s*:/i, '').trim();
  }

  const firstSentence = lines.find((line) => line.trim().length > 0 && !/^\s*[-*\d#]/.test(line));
  return firstSentence?.trim() ?? null;
}

function parseId(lines: string[], title: string): string {
  const explicitId = lines.find((line) => /^\s*id\s*:/i.test(line));
  if (explicitId) {
    const raw = explicitId.replace(/^\s*id\s*:/i, '').trim();
    if (raw.length > 0) {
      return raw;
    }
  }

  const reqHeading = lines.find((line) => /REQ-\d+/i.test(line));
  if (reqHeading) {
    const match = reqHeading.match(/REQ-\d+/i);
    if (match) {
      return match[0].toUpperCase();
    }
  }

  return toStableId(title);
}

function parseTags(text: string, lines: string[]): string[] {
  const tags = new Set<string>();

  const tagLine = lines.find(
    (line) => /^\s*tags?\s*:/i.test(line) || /^\s*-\s+\*\*Tags:\*\*/i.test(line),
  );
  if (tagLine) {
    const raw = tagLine
      .replace(/^\s*-\s+\*\*Tags:\*\*/i, '')
      .replace(/^\s*tags?\s*:/i, '')
      .trim();
    for (const token of raw.split(/[\s,]+/)) {
      const clean = token.replace(/^#/, '').trim().toLowerCase();
      if (clean) {
        tags.add(clean);
      }
    }
  }

  const hashTagRegex = /(^|\s)#([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null = hashTagRegex.exec(text);
  while (match) {
    tags.add(match[2].toLowerCase());
    match = hashTagRegex.exec(text);
  }

  return Array.from(tags);
}

function extractSectionLines(lines: string[], sectionPattern: RegExp): string[] {
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (inSection && !sectionPattern.test(line)) {
        break;
      }
      inSection = sectionPattern.test(line);
      continue;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines;
}

function parseMetadataValue(line: string): { key: string; value: string } | null {
  const bullet = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.+)$/);
  if (bullet) {
    return { key: bullet[1].trim().toLowerCase(), value: bullet[2].trim() };
  }
  const plain = line.match(/^\s*([a-zA-Z\s]+):\s*(.+)$/);
  if (plain) {
    return { key: plain[1].trim().toLowerCase(), value: plain[2].trim() };
  }
  return null;
}

function parseMetadata(lines: string[], text: string): RequirementMetadata | undefined {
  const sectionLines = extractSectionLines(lines, /^##\s+metadata$/i);
  if (sectionLines.length === 0) {
    return undefined;
  }

  const metadata: RequirementMetadata = { tags: [] };

  for (const line of sectionLines) {
    const parsed = parseMetadataValue(line);
    if (!parsed) {
      continue;
    }

    const { key, value } = parsed;

    if (key === 'tags') {
      for (const token of value.split(/[\s,]+/)) {
        const clean = token.replace(/^#/, '').trim().toLowerCase();
        if (clean) {
          metadata.tags.push(clean);
        }
      }
    } else if (key === 'prioritas' || key === 'priority') {
      metadata.priority = value.toLowerCase();
    } else if (key === 'auth state') {
      const normalized = value.toLowerCase();
      if (normalized === 'unauthenticated' || normalized === 'authenticated') {
        metadata.authState = normalized;
      }
    } else if (key === 'halaman awal' || key === 'start page' || key === 'target page') {
      metadata.startPage = value;
    } else if (key === 'pom yang dibutuhkan' || key === 'pom fixtures' || key === 'pom') {
      metadata.pomFixtures = value
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const globalTags = parseTags(text, lines);
  const mergedTags = new Set([...metadata.tags, ...globalTags]);
  metadata.tags = Array.from(mergedTags);

  if (
    metadata.tags.length === 0 &&
    !metadata.priority &&
    !metadata.authState &&
    !metadata.startPage &&
    !metadata.pomFixtures
  ) {
    return undefined;
  }

  return metadata;
}

function parseAcceptanceCriteriaFromLines(lines: string[]): AcceptanceCriterion[] {
  const criteria: string[] = [];

  const bulletOrNumbered = lines
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/)?.[1]?.trim() ?? null)
    .filter((line): line is string => Boolean(line));

  if (bulletOrNumbered.length > 0) {
    criteria.push(...bulletOrNumbered);
  } else {
    const shallStyle = lines
      .map((line) => line.trim())
      .filter((line) => /(shall|must|should|harus|wajib|bisa|dapat)/i.test(line));

    criteria.push(...shallStyle);
  }

  return criteria
    .filter((criterion) => criterion.length > 0)
    .map((description, index) => ({
      id: `AC-${index + 1}`,
      description,
    }));
}

function parseAcceptanceCriteria(lines: string[]): AcceptanceCriterion[] {
  const criteriaSection = extractSectionLines(
    lines,
    /(?:kriteria\s+penerimaan|acceptance\s+criteria)/i,
  );
  if (criteriaSection.length > 0) {
    return parseAcceptanceCriteriaFromLines(criteriaSection);
  }

  return [];
}

export function normalizeRequirements(
  options:
    | string
    | {
        requirementsText?: string;
        requirementPath?: string;
      },
): NormalizeRequirementsOutput {
  const input = typeof options === 'string' ? { requirementsText: options } : options;
  let requirementsText = input.requirementsText;

  if (input.requirementPath) {
    const resolved = resolveAllowedPath(input.requirementPath, 'requirements', {
      mustExist: true,
      readOnly: true,
    });
    if (!resolved.ok) {
      return {
        status: 'error',
        error: { code: resolved.error.code, message: resolved.error.message },
      };
    }
    requirementsText = fs.readFileSync(resolved.absolutePath, 'utf-8');
  }

  if (typeof requirementsText !== 'string') {
    return {
      status: 'error',
      error: {
        code: 'INVALID_TYPE',
        message: 'Provide requirementsText or requirementPath.',
      },
    };
  }

  const normalizedText = requirementsText.trim();
  if (normalizedText.length === 0) {
    return {
      status: 'error',
      error: {
        code: 'EMPTY_INPUT',
        message: 'requirementsText cannot be empty or whitespace-only.',
      },
    };
  }

  const sizeError = assertRequirementsTextSize(normalizedText);
  if (sizeError) {
    return {
      status: 'error',
      error: { code: sizeError.code, message: sizeError.message },
    };
  }

  const lines = normalizedText.split(/\r?\n/);
  const title = parseTitle(lines);

  if (!title) {
    return {
      status: 'error',
      error: {
        code: 'MALFORMED_INPUT',
        message: 'Unable to derive requirement title from the provided text.',
      },
    };
  }

  const acceptanceCriteria = parseAcceptanceCriteria(lines);
  const scenarios = parseRequirementScenariosFromText(normalizedText);
  const metadata = parseMetadata(lines, normalizedText);
  const tags = metadata?.tags?.length ? metadata.tags : parseTags(normalizedText, lines);

  if (acceptanceCriteria.length === 0 && scenarios.length === 0) {
    return {
      status: 'error',
      error: {
        code: 'MALFORMED_INPUT',
        message:
          'No acceptance criteria or test scenarios found. Use ## Kriteria Penerimaan bullets or ### scenario headings with Langkah/Hasil.',
      },
    };
  }

  const contract: RequirementsContract = {
    id: parseId(lines, title),
    title,
    acceptanceCriteria,
    tags,
  };

  if (metadata) {
    contract.metadata = metadata;
  }

  if (scenarios.length > 0) {
    contract.scenarios = scenarios;
  }

  logger.info(
    '[qa-playwright-kit] normalize_requirements is in maintenance mode; prefer compile_requirement (qa.requirement/v1).',
  );
  logger.info('Requirements normalized successfully.', {
    id: contract.id,
    criteriaCount: contract.acceptanceCriteria.length,
    scenarioCount: scenarios.length,
    tagCount: contract.tags.length,
  });

  return {
    status: 'success',
    contract,
  };
}
