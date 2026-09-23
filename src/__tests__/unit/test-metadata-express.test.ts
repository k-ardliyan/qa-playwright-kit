import { test, expect } from '@playwright/test';
import { setTestMetadata, captureActualResult } from '../../support/test-metadata';

test.describe('TestMetadata Express Mode annotations', () => {
  test('injects reqRef and track annotations into test info', async () => {
    setTestMetadata({
      testId: 'TC-EXPRESS-01',
      reqRef: 'REQ-CHECKOUT-01',
      track: 'express',
      priority: 'HIGH',
      role: 'finance',
    });

    captureActualResult('Diskon checkout 10% berhasil diaplikasikan');

    const annotations = test.info().annotations;
    const reqAnno = annotations.find((a) => a.type === 'requirement');
    const trackAnno = annotations.find((a) => a.type === 'track');
    const testIdAnno = annotations.find((a) => a.type === 'testId');
    const actualAnno = annotations.find((a) => a.type === 'actualResult');

    expect(reqAnno).toBeDefined();
    expect(reqAnno?.description).toBe('REQ-CHECKOUT-01');

    expect(trackAnno).toBeDefined();
    expect(trackAnno?.description).toBe('express');

    expect(testIdAnno?.description).toBe('TC-EXPRESS-01');
    expect(actualAnno?.description).toBe('Diskon checkout 10% berhasil diaplikasikan');
  });
});
