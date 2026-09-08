import { getAdapterTraceabilityExemptPrefix } from '../../utils/playwright-paths';

export interface ValidationViolation {
  filePath: string;
  lineNumber: number;
  ruleName: string;
  severity?: 'error' | 'warning';
}

const TRACEABILITY_EXEMPT_PREFIXES_STATIC: ReadonlyArray<string> = ['tests/demo/'];
const TRACEABILITY_EXEMPT_FILES: ReadonlyArray<string> = ['tests/seed.spec.ts'];

export function getTraceabilityExemptPrefixes(): string[] {
  return [...TRACEABILITY_EXEMPT_PREFIXES_STATIC, getAdapterTraceabilityExemptPrefix()];
}

export function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function isTraceabilityExempt(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.includes('__property_')) {
    return true;
  }
  if (TRACEABILITY_EXEMPT_FILES.includes(normalized)) {
    return true;
  }
  return getTraceabilityExemptPrefixes().some((prefix) => normalized.startsWith(prefix));
}
