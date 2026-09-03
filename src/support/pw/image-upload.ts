/**
 * Image upload helpers — upload image files and verify preview renders.
 *
 * Common ERP pattern: upload employee photo, product image, document scan.
 * Validates image dimensions, format, and verifies preview thumbnail after upload.
 *
 * @module src/support/pw/image-upload
 */

import * as fs from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { uploadFixture, resolveUploadFixturePath } from './files';
import { detectFileKind } from './file-content-core';

export interface ImageValidationResult {
  valid: boolean;
  errors: string[];
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ImageUploadVerifyResult {
  uploaded: boolean;
  previewVisible: boolean;
  previewSrc?: string;
}

export interface ImageUploadOptions {
  /** File input locator or click trigger */
  trigger: Locator;
  /** Image fixture path under tests/data/ or absolute */
  imagePath: string;
  /** Preview container locator (after upload) */
  previewLocator: Locator;
  /** Minimum preview dimensions (px) */
  minPreviewDimensions?: { width: number; height: number };
  /** Timeout for preview to appear (ms) */
  timeout?: number;
}

/**
 * Upload an image file and verify preview renders.
 *
 * Flow:
 * 1. Validate image fixture (format, size)
 * 2. Upload via file input
 * 3. Wait for preview element to appear
 * 4. Optionally verify preview dimensions
 *
 * @example
 * ```ts
 * const result = await uploadImageAndVerify(page, {
 *   trigger: page.locator('input[type="file"]'),
 *   imagePath: 'images/employee-photo.png',
 *   previewLocator: page.locator('.avatar-preview img'),
 *   minPreviewDimensions: { width: 100, height: 100 },
 * });
 * expect(result.previewVisible).toBe(true);
 * ```
 */
export async function uploadImageAndVerify(
  page: Page,
  options: ImageUploadOptions,
): Promise<ImageUploadVerifyResult> {
  const { trigger, imagePath, previewLocator, minPreviewDimensions, timeout } = options;

  // 1. Resolve and validate fixture
  const resolvedPath = resolveUploadFixturePath(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Image fixture not found: ${resolvedPath}`);
  }

  const kind = detectFileKind(resolvedPath);
  if (!['png', 'jpg', 'gif'].includes(kind)) {
    throw new Error(`Expected image file, got ${kind}: ${resolvedPath}`);
  }

  // 2. Upload
  await uploadFixture(trigger, imagePath);

  // 3. Wait for preview
  let previewVisible: boolean;
  try {
    await expect(previewLocator).toBeVisible({ timeout: timeout ?? 10_000 });
    previewVisible = true;
  } catch {
    previewVisible = false;
  }

  // 4. Verify preview dimensions (if requested)
  let previewSrc: string | undefined;
  if (previewVisible && minPreviewDimensions) {
    try {
      const imgLocator = page.locator('img').and(previewLocator);
      const count = await imgLocator.count();
      if (count > 0) {
        const dims = await imgLocator.first().evaluate((el: HTMLImageElement) => ({
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          src: el.src,
        }));
        previewSrc = dims.src;

        if (minPreviewDimensions.width && dims.naturalWidth < minPreviewDimensions.width) {
          throw new Error(
            `Preview width ${dims.naturalWidth}px < minimum ${minPreviewDimensions.width}px`,
          );
        }
        if (minPreviewDimensions.height && dims.naturalHeight < minPreviewDimensions.height) {
          throw new Error(
            `Preview height ${dims.naturalHeight}px < minimum ${minPreviewDimensions.height}px`,
          );
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        !err.message.includes('Preview width') &&
        !err.message.includes('Preview height')
      ) {
        // Not an image element or not evaluateable — skip dimension check
      } else {
        throw err;
      }
    }
  }

  // Try to get src even without dimension check
  if (!previewSrc && previewVisible) {
    try {
      const imgLocator = page.locator('img').and(previewLocator);
      const count = await imgLocator.count();
      if (count > 0) {
        previewSrc = (await imgLocator.first().getAttribute('src')) ?? undefined;
      }
    } catch {
      // ignore
    }
  }

  return {
    uploaded: true,
    previewVisible,
    previewSrc,
  };
}

/**
 * Verify uploaded image dimensions in a preview element.
 *
 * @example
 * ```ts
 * await expectImagePreviewDimensions(
 *   page.locator('.avatar-preview img'),
 *   { minWidth: 100, minHeight: 100 },
 * );
 * ```
 */
export async function expectImagePreviewDimensions(
  previewLocator: Locator,
  expected: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number },
): Promise<void> {
  const dims = await previewLocator.evaluate((el: HTMLImageElement) => ({
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
  }));

  if (expected.minWidth && dims.naturalWidth < expected.minWidth) {
    throw new Error(`Image width ${dims.naturalWidth}px < minimum ${expected.minWidth}px`);
  }
  if (expected.minHeight && dims.naturalHeight < expected.minHeight) {
    throw new Error(`Image height ${dims.naturalHeight}px < minimum ${expected.minHeight}px`);
  }
  if (expected.maxWidth && dims.naturalWidth > expected.maxWidth) {
    throw new Error(`Image width ${dims.naturalWidth}px > maximum ${expected.maxWidth}px`);
  }
  if (expected.maxHeight && dims.naturalHeight > expected.maxHeight) {
    throw new Error(`Image height ${dims.naturalHeight}px > maximum ${expected.maxHeight}px`);
  }
}

/**
 * Validate an image fixture file before upload.
 * Checks dimensions, format, and file size.
 *
 * Note: For dimension detection, reads the first 32 bytes of the file
 * to parse PNG/JPEG headers without external dependencies.
 *
 * @example
 * ```ts
 * const result = await validateImageFixture('images/employee-photo.png', {
 *   maxBytes: 5 * 1024 * 1024, // 5MB
 *   allowedFormats: ['png', 'jpg'],
 * });
 * if (!result.valid) throw new Error(result.errors.join(', '));
 * ```
 */
export async function validateImageFixture(
  fixturePath: string,
  options?: {
    minBytes?: number;
    maxBytes?: number;
    minWidth?: number;
    minHeight?: number;
    allowedFormats?: Array<'png' | 'jpg' | 'gif'>;
  },
): Promise<ImageValidationResult> {
  const resolvedPath = resolveUploadFixturePath(fixturePath);
  const errors: string[] = [];

  if (!fs.existsSync(resolvedPath)) {
    return {
      valid: false,
      errors: [`File not found: ${resolvedPath}`],
      format: 'unknown',
      width: 0,
      height: 0,
      sizeBytes: 0,
    };
  }

  const stat = fs.statSync(resolvedPath);
  const buffer = fs.readFileSync(resolvedPath);
  const kind = detectFileKind(resolvedPath, buffer);
  const sizeBytes = stat.size;

  // Parse dimensions from file header
  const dims = parseImageDimensions(buffer);

  // Validate format
  const allowedFormats = options?.allowedFormats ?? ['png', 'jpg', 'gif'];
  if (!allowedFormats.includes(kind as 'png' | 'jpg' | 'gif')) {
    errors.push(`Format ${kind} not allowed. Allowed: ${allowedFormats.join(', ')}`);
  }

  // Validate file size
  if (options?.minBytes && sizeBytes < options.minBytes) {
    errors.push(`File size ${sizeBytes} bytes < minimum ${options.minBytes} bytes`);
  }
  if (options?.maxBytes && sizeBytes > options.maxBytes) {
    errors.push(`File size ${sizeBytes} bytes > maximum ${options.maxBytes} bytes`);
  }

  // Validate dimensions
  if (options?.minWidth && dims.width > 0 && dims.width < options.minWidth) {
    errors.push(`Image width ${dims.width}px < minimum ${options.minWidth}px`);
  }
  if (options?.minHeight && dims.height > 0 && dims.height < options.minHeight) {
    errors.push(`Image height ${dims.height}px < minimum ${options.minHeight}px`);
  }

  return {
    valid: errors.length === 0,
    errors,
    format: kind,
    width: dims.width,
    height: dims.height,
    sizeBytes,
  };
}

// ─── Internal: Parse image dimensions from binary headers ────────────────────

interface ParsedDimensions {
  width: number;
  height: number;
}

/**
 * Parse image dimensions from PNG/JPEG/GIF binary headers.
 * No external dependencies required.
 */
function parseImageDimensions(buffer: Buffer): ParsedDimensions {
  // PNG: width at offset 16 (4 bytes BE), height at offset 20 (4 bytes BE)
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  // JPEG: find SOF0/SOF2 marker
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      // SOF0 (0xffc0) or SOF2 (0xffc2)
      if (marker === 0xc0 || marker === 0xc2) {
        if (offset + 9 < buffer.length) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          };
        }
      }
      // Skip to next marker
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
      } else {
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
  }

  // GIF: width at offset 6 (2 bytes LE), height at offset 8 (2 bytes LE)
  if (buffer.length >= 10) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8),
      };
    }
  }

  return { width: 0, height: 0 };
}
