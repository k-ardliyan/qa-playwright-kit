import { test, expect } from '@playwright/test';
import { resolveAppUrl } from '../app-url';

test.describe('resolveAppUrl helper', () => {
  test('returns absolute URLs as-is', () => {
    expect(resolveAppUrl('https://example.com/login')).toBe('https://example.com/login');
    expect(resolveAppUrl('http://localhost:8080/api')).toBe('http://localhost:8080/api');
  });

  test('joins path against baseUrlOverride without trailing slash', () => {
    expect(resolveAppUrl('/login', 'https://example.com')).toBe('https://example.com/login');
    expect(resolveAppUrl('login', 'https://example.com')).toBe('https://example.com/login');
  });

  test('preserves subpath in baseUrlOverride (avoids root-absolute new URL trap)', () => {
    const base = 'https://lms.example.com/siakad/STRING';
    expect(resolveAppUrl('/login', base)).toBe('https://lms.example.com/siakad/STRING/login');
    expect(resolveAppUrl('login', base)).toBe('https://lms.example.com/siakad/STRING/login');
  });

  test('strips trailing slash from baseUrlOverride before joining', () => {
    const base = 'https://example.com/sub/';
    expect(resolveAppUrl('/login', base)).toBe('https://example.com/sub/login');
  });

  test('falls back to process.env.BASE_URL when override is not provided', () => {
    const prev = process.env.BASE_URL;
    process.env.BASE_URL = 'https://env-base.com';
    try {
      expect(resolveAppUrl('/dashboard')).toBe('https://env-base.com/dashboard');
    } finally {
      process.env.BASE_URL = prev;
    }
  });

  test('returns path as-is if no BASE_URL and no override', () => {
    const prev = process.env.BASE_URL;
    delete process.env.BASE_URL;
    try {
      expect(resolveAppUrl('/login')).toBe('/login');
    } finally {
      process.env.BASE_URL = prev;
    }
  });
});
