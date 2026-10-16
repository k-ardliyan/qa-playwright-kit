import { test, expect } from '@playwright/test';
import { parseArgs } from '../../cli/archive';

test.describe('archive parseArgs', () => {
  test('parses --key=value form', () => {
    expect(parseArgs(['node', 'cli', '--decision=APPROVE'])).toEqual({ decision: 'APPROVE' });
  });

  test('parses --key value form', () => {
    expect(parseArgs(['node', 'cli', '--decision', 'APPROVE'])).toEqual({ decision: 'APPROVE' });
  });

  test('parses bare boolean flags', () => {
    expect(parseArgs(['node', 'cli', '--yes'])).toEqual({ yes: true });
  });

  test('parses notes with spaces', () => {
    expect(parseArgs(['node', 'cli', '--notes', 'clean run', '--yes'])).toEqual({
      notes: 'clean run',
      yes: true,
    });
  });

  test('ignores non-flag args (command name)', () => {
    expect(parseArgs(['node', 'cli', 'save', '--yes'])).toEqual({ yes: true });
  });

  test('parses --label, --series, --requirement-id, and --requirement-title', () => {
    expect(
      parseArgs([
        'node',
        'cli',
        'save',
        '--decision=APPROVE',
        '--label=Login Staging RC1',
        '--series=auth-login',
        '--requirement-id=REQ-AUTH-001',
        '--requirement-title=Authentication Flow',
        '--yes',
      ]),
    ).toEqual({
      decision: 'APPROVE',
      label: 'Login Staging RC1',
      series: 'auth-login',
      'requirement-id': 'REQ-AUTH-001',
      'requirement-title': 'Authentication Flow',
      yes: true,
    });
  });
});
