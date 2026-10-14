import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ValidateRunManifest {
  runId: string;
  requirementPath: string;
  generatedFiles: string[];
  resultsDir: string;
  summaryPath: string;
  startedAt: string;
  completedAt?: string;
}

export function writeValidateRunManifest(root: string, manifest: ValidateRunManifest): string {
  const manifestPath = path.join(manifest.resultsDir, 'run-manifest.json');
  fs.mkdirSync(manifest.resultsDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifestPath;
}

export function readValidateRunManifest(manifestPath: string): ValidateRunManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ValidateRunManifest;
    if (
      typeof parsed.runId !== 'string' ||
      typeof parsed.requirementPath !== 'string' ||
      typeof parsed.resultsDir !== 'string' ||
      typeof parsed.summaryPath !== 'string' ||
      typeof parsed.startedAt !== 'string' ||
      !Array.isArray(parsed.generatedFiles)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function assertCurrentValidateManifest(
  manifest: ValidateRunManifest | null,
  expected: Pick<ValidateRunManifest, 'runId' | 'requirementPath' | 'resultsDir'>,
): void {
  if (!manifest)
    throw new Error('VALIDATE_STALE_EVIDENCE: current-run manifest is missing or invalid.');
  if (
    manifest.runId !== expected.runId ||
    manifest.requirementPath !== expected.requirementPath ||
    path.resolve(manifest.resultsDir) !== path.resolve(expected.resultsDir)
  ) {
    throw new Error('VALIDATE_STALE_EVIDENCE: result manifest does not match the current run.');
  }
}
