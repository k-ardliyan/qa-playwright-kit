import type { ValidationViolation } from './rule-helpers';
import { isTraceabilityExempt } from './rule-helpers';

/**
 * Capability tags in file content (describe/test tags or comments) must pair with
 * official power helpers from `@/support/pw` (or equivalent deep import / raw API).
 *
 * Demo/property/seed paths are exempt via isTraceabilityExempt + explicit demo prefix.
 */
export function validateCapabilityPowerRules(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const lower = content;

  const hasPwImport = /from\s*['"]@\/support\/pw(?:\/[^'"]*)?['"]/.test(content);
  const hasRouteApi =
    /\.route\s*\(/.test(content) || /\bmockJson\b|\bmockServerError\b|\bmockAbort\b/.test(content);
  const hasRequestApi =
    /\brequest\b/.test(content) &&
    (/\bapiSeed\b|\bapiJson\b|\bapiCleanup\b/.test(content) ||
      /request\.(get|post|put|patch|delete|fetch)\s*\(/.test(content));
  const hasAriaApi =
    /\btoMatchAriaSnapshot\b|\bexpectAriaSnapshot\b|\bexpectAriaMatchesCatalog\b/.test(content);
  const hasVisualApi = /\btoHaveScreenshot\b|\bexpectVisual\b|\bexpectPageVisual\b/.test(content);
  const hasDownloadApi =
    /waitForEvent\s*\(\s*['"]download['"]\s*\)/.test(content) ||
    /\bdownloadAndSave\b/.test(content) ||
    /\bdownloadFile\b/.test(content);
  const hasUploadApi =
    /\bsetInputFiles\b/.test(content) ||
    /\buploadFixture\b/.test(content) ||
    /\bdropFixture\b/.test(content) ||
    /\buploadViaChooser\b/.test(content) ||
    /\buploadFile\b/.test(content) ||
    /\bdropFile\b/.test(content);
  const hasFileContentApi =
    /\bassertPdfContains\b/.test(content) ||
    /\bassertPdfMatches\b/.test(content) ||
    /\bextractPdfText\b/.test(content) ||
    /\bassertExcelHeaders\b/.test(content) ||
    /\breadExcelSummary\b/.test(content) ||
    /\bassertDownloadedEnvelope\b/.test(content) ||
    /\bassertFileMagic\b/.test(content) ||
    /\bdetectMagic\b/.test(content) ||
    /\bdetectFileKind\b/.test(content);
  const hasNetworkAssertApi =
    /\bwaitForApi\b/.test(content) ||
    /\bwaitAndAssertApi\b/.test(content) ||
    /\bassertNetworkContract\b/.test(content) ||
    /\bassertNetworkMatch\b/.test(content) ||
    /\bstartNetworkRecorder\b/.test(content) ||
    /\bwaitForResponse\b/.test(content) ||
    /\bwaitForRequest\b/.test(content);

  // Live observe first — @network\b alone would also match @network-assert
  const mentionsNetworkAssert =
    /@network-assert\b/.test(lower) ||
    /\(@network-assert\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@network-assert'/.test(lower) ||
    /tag:\s*\[[^\]]*"@network-assert"/.test(lower);
  // Mock-only: exclude @network-assert (negative lookahead after "network")
  const mentionsNetwork =
    /@network(?!-assert)\b/.test(lower) ||
    /\(@network\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@network'/.test(lower) ||
    /tag:\s*\[[^\]]*"@network"/.test(lower);
  const mentionsHybrid =
    /@hybrid\b/.test(lower) ||
    /\(@hybrid\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@hybrid'/.test(lower) ||
    /tag:\s*\[[^\]]*"@hybrid"/.test(lower);
  const mentionsAria =
    /@aria\b/.test(lower) ||
    /\(@aria\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@aria'/.test(lower) ||
    /tag:\s*\[[^\]]*"@aria"/.test(lower);
  const mentionsVisual =
    /@visual\b/.test(lower) ||
    /\(@visual\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@visual'/.test(lower) ||
    /tag:\s*\[[^\]]*"@visual"/.test(lower);
  const mentionsDownload =
    /@download\b/.test(lower) ||
    /\(@download\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@download'/.test(lower) ||
    /tag:\s*\[[^\]]*"@download"/.test(lower);
  const mentionsUpload =
    /@upload\b/.test(lower) ||
    /\(@upload\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@upload'/.test(lower) ||
    /tag:\s*\[[^\]]*"@upload"/.test(lower);
  const mentionsFileContent =
    /@file-content\b/.test(lower) ||
    /\(@file-content\)/.test(lower) ||
    /tag:\s*\[[^\]]*'@file-content'/.test(lower) ||
    /tag:\s*\[[^\]]*"@file-content"/.test(lower);

  if (mentionsNetwork && !hasRouteApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@network): must use page.route or import mockJson/mockServerError/mockAbort from @/support/pw',
    });
  }

  if (mentionsNetworkAssert && !hasNetworkAssertApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@network-assert): must use waitAndAssertApi/waitForApi/assertNetworkContract/assertNetworkMatch/startNetworkRecorder or page.waitForResponse/waitForRequest',
    });
  }

  if (mentionsHybrid && !hasRequestApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@hybrid): must use request fixture with apiSeed/apiJson/apiCleanup or request.get/post/…',
    });
  }

  if (mentionsAria && !hasAriaApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@aria): must call toMatchAriaSnapshot or expectAriaSnapshot/expectAriaMatchesCatalog',
    });
  }

  if (mentionsVisual && !hasVisualApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@visual): must call toHaveScreenshot or expectVisual/expectPageVisual from @/support/pw',
    });
  }

  if (mentionsDownload && !hasDownloadApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        "Capability rule (@download): must use waitForEvent('download') or downloadAndSave/downloadFile from @/support/pw or BasePage",
    });
  }

  if (mentionsUpload && !hasUploadApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@upload): must use setInputFiles or uploadFixture/dropFixture/uploadViaChooser/uploadFile/dropFile',
    });
  }

  if (mentionsFileContent && !hasFileContentApi) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Capability rule (@file-content): must use assertPdfContains/assertPdfMatches/extractPdfText/assertExcelHeaders/readExcelSummary/assertDownloadedEnvelope/assertFileMagic from @/support/pw (needles from scenario)',
    });
  }

  // Soft nudge: if multiple capability tags used, prefer barrel import (warning-as-violation only if none of APIs match — already covered)
  void hasPwImport;

  return violations;
}
