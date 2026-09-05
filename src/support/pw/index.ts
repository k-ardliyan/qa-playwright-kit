/**
 * Playwright power helpers — official-API wrappers for Generator + human authors.
 *
 * Import from `@/support/pw`:
 *   import { mockJson, apiSeed, expectAriaSnapshot, expectVisual, freezeTime } from '@/support/pw';
 *   import { downloadAndSave, uploadFixture, assertPdfContains } from '@/support/pw';
 *   import { waitForApi, assertNetworkContract } from '@/support/pw';
 */

export { mockJson, mockServerError, mockAbort, mockText, unmockAll } from './network-mock';

export {
  waitForApi,
  waitAndAssertApi,
  assertNetworkMatch,
  assertNetworkContract,
  startNetworkRecorder,
  attachNetworkCapture,
  useHar,
  type WaitForApiMatch,
  type WaitForApiResult,
  type WaitAndAssertSpec,
  type RecorderOptions,
  type NetworkRecorder,
} from './network-assert';

export {
  loadNetworkContract,
  matchNetworkHit,
  redactHit,
  redactHeaders,
  redactBody,
  assertNetworkContractHit,
  resolveNetworkContractPath,
  type NetworkHit,
  type NetworkMatchSpec,
  type NetworkContractFile,
  type NetworkBodyMatch,
} from './network-assert-core';

export { readAriaCatalog, expectAriaMatchesCatalog, expectAriaSnapshot } from './aria-snapshot';

export { apiJson, apiSeed, apiCleanup, type ApiJsonResult, type HttpMethod } from './api-seed';

export { expectAllVisible, expectAllToContainText, expectSoftFieldErrors } from './soft-forms';

export { expectVisual, expectPageVisual, type VisualOptions } from './visual';

export { freezeTime, advanceTime, setTime, resumeRealTime } from './clock';

export {
  buildRoleProject,
  buildRoleProjects,
  roleStorageStatePath,
  type RoleProjectOptions,
} from './role-projects';

export {
  downloadAndSave,
  uploadFixture,
  dropFixture,
  uploadViaChooser,
  resolveUploadFixturePath,
  assertDownloadedEnvelope,
  assertPdfContains,
  assertPdfMatches,
  assertExcelHeaders,
  assertFileMagic,
  extractPdfText,
  fixturePath,
  detectMagic,
  detectFileKind,
  readExcelSummary,
  inspectFileLocal,
  getFileKind,
  type FileKind,
  type ExcelSummary,
  type InspectFileResult,
} from './files';

export {
  downloadIf,
  downloadTemplateWithMaster,
  downloadTemplateWithMasterApi,
  type DownloadIfOptions,
  type DownloadResult,
} from './conditional-download';

export {
  uploadImageAndVerify,
  expectImagePreviewDimensions,
  validateImageFixture,
  type ImageValidationResult,
  type ImageUploadVerifyResult,
  type ImageUploadOptions,
} from './image-upload';

export {
  verifyUploadedFileInList,
  verifyUploadViaApi,
  uploadAndVerify,
  type UploadVerifyResult,
} from './upload-verify';

export { templateRoundtrip, type TemplateRoundtripResult } from './template-roundtrip';

export {
  withTemporaryRoute,
  cleanupActiveRoutes,
  withOfflineMode,
  trackActiveRoute,
  untrackActiveRoute,
} from './network-lifecycle';
