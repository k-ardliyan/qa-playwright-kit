/**
 * Unit tests for deriveActualFailureMessage in custom-reporter.ts
 */
import { test, expect } from '@playwright/test';
import { deriveActualFailureMessage } from '../../custom-reporter';
import type { TestResult } from '@playwright/test/reporter';

test.describe('deriveActualFailureMessage', () => {
  test('strips ANSI codes and extracts locator timeout reason', () => {
    const mockResult = {
      status: 'timedOut',
      error: {
        message: '\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m',
        stack: 'waiting for locator(\'input[name="password"]\') to be visible',
      },
      errors: [
        {
          message: '\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m',
        },
        {
          message:
            'Error: locator.fill: Test timeout of 30000ms exceeded.\nCall log:\n  - waiting for locator(\'input[name="password"]\')',
        },
      ],
      steps: [
        {
          title: 'Buka halaman login',
          error: undefined,
          steps: [],
        },
        {
          title: 'Isi kredensial dan submit form login',
          error: { message: 'locator.fill timeout' },
          steps: [],
        },
      ],
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult);
    expect(actual).not.toContain('\u001b[31m');
    expect(actual).not.toContain('[31m');
    expect(actual).toContain('Gagal pada langkah: "Isi kredensial dan submit form login"');
    expect(actual).toContain('waiting for locator(\'input[name="password"]\')');
  });

  test('extracts navigation URL timeout reason', () => {
    const mockResult = {
      status: 'timedOut',
      error: {
        message: 'Test timeout of 30000ms exceeded.',
      },
      errors: [
        {
          message:
            'page.waitForURL: Test timeout of 30000ms exceeded.\nwaiting for navigation to "**/dashboard**"',
        },
      ],
      steps: [
        {
          title: 'Tunggu redirect sukses dan simpan session baru',
          error: { message: 'waitForURL timeout' },
          steps: [],
        },
      ],
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult);
    expect(actual).toContain(
      'Gagal pada langkah: "Tunggu redirect sukses dan simpan session baru"',
    );
    expect(actual).toContain('waiting for navigation to "**/dashboard**"');
  });

  test('extracts assertion mismatch (Expected vs Received)', () => {
    const mockResult = {
      status: 'failed',
      error: {
        message:
          'Error: expect(received).toHaveText(expected)\n\nExpected string: "Dashboard Admin"\nReceived string: "Login Form"',
      },
      errors: [
        {
          message:
            'Error: expect(received).toHaveText(expected)\n\nExpected string: "Dashboard Admin"\nReceived string: "Login Form"',
        },
      ],
      steps: [
        {
          title: 'Verifikasi header dashboard',
          error: { message: 'assertion failed' },
          steps: [],
        },
      ],
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult);
    expect(actual).toContain('Gagal pada langkah: "Verifikasi header dashboard"');
    expect(actual).toContain('Diharapkan: "Dashboard Admin"');
    expect(actual).toContain('Diterima: "Login Form"');
  });

  test('extracts connection failure (net::ERR_CONNECTION_REFUSED)', () => {
    const mockResult = {
      status: 'failed',
      error: {
        message: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login',
      },
      errors: [
        { message: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login' },
      ],
      steps: [
        {
          title: 'Buka halaman login',
          error: { message: 'connection refused' },
          steps: [],
        },
      ],
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult);
    expect(actual).toContain('Gagal pada langkah: "Buka halaman login"');
    expect(actual).toContain('Koneksi gagal: net::ERR_CONNECTION_REFUSED');
  });

  test('extracts element interception error', () => {
    const mockResult = {
      status: 'failed',
      error: {
        message:
          'Error: locator.click: Target closed\n=========================== logs ===========================\nelement is not visible',
      },
      errors: [{ message: 'element is not visible' }],
      steps: [
        {
          title: 'Klik tombol submit',
          error: { message: 'click failed' },
          steps: [],
        },
      ],
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult);
    expect(actual).toContain('Gagal pada langkah: "Klik tombol submit"');
    expect(actual).toContain('Interaksi terhalang: element is not visible');
  });

  test('prioritizes explicit annotation if provided', () => {
    const mockResult = {
      status: 'failed',
      error: { message: 'Some error' },
    } as unknown as TestResult;

    const actual = deriveActualFailureMessage(mockResult, 'Custom failure annotation');
    expect(actual).toBe('Custom failure annotation');
  });
});
