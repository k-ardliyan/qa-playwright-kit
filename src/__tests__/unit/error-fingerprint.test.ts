import { test, expect } from '@playwright/test';
import {
  generateErrorFingerprint,
  clusterFailuresByFingerprint,
} from '../../support/classifier/fingerprint';

test.describe('Error Fingerprinting & Clustering Engine', () => {
  test('generates identical fingerprint for errors with different dynamic UUIDs and timestamps', () => {
    const err1 =
      'Error: Item not found with ID 123e4567-e89b-12d3-a456-426614174000 at 2026-08-31T10:00:00Z';
    const err2 =
      'Error: Item not found with ID 987fcdeb-51a2-43f7-9876-543210987654 at 2026-08-31T12:34:56Z';

    const fp1 = generateErrorFingerprint(err1);
    const fp2 = generateErrorFingerprint(err2);

    expect(fp1.fingerprintId).toBe(fp2.fingerprintId);
    expect(fp1.normalizedMessage).toBe('Error: Item not found with ID <UUID> at <TIMESTAMP>');
  });

  test('normalizes locator waiting messages and memory addresses', () => {
    const err1 =
      "TimeoutError: locator.click: Timeout 5000ms exceeded.\nwaiting for locator('button#submit-btn-0x7fff')";
    const err2 =
      "TimeoutError: locator.click: Timeout 5000ms exceeded.\nwaiting for locator('button#submit-btn-0x8aaa')";

    const fp1 = generateErrorFingerprint(err1);
    const fp2 = generateErrorFingerprint(err2);

    expect(fp1.fingerprintId).toBe(fp2.fingerprintId);
  });

  test('clusters failure objects by their root cause signature', () => {
    const failures = [
      { id: 'SC-01', errorMessage: 'Connection refused at http://localhost:3000/api/v1' },
      { id: 'SC-02', errorMessage: 'Connection refused at http://localhost:8080/api/v2' },
      { id: 'SC-03', errorMessage: 'Element not found: button#login' },
    ];

    const clusters = clusterFailuresByFingerprint(failures);

    expect(clusters.size).toBe(2);
    const connCluster = Array.from(clusters.values()).find((c) =>
      c.fingerprint.normalizedMessage.includes('Connection refused'),
    );
    expect(connCluster).toBeDefined();
    expect(connCluster?.items.length).toBe(2);
  });
});
