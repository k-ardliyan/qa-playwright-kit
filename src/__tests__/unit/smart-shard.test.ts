import { test, expect } from '@playwright/test';
import { partitionSpecsLPT, type SpecDurationMap } from '../../../tools/scripts/smart-shard';

test.describe('Smart Sharding via LPT Algorithm', () => {
  test('optimally balances heavily skewed spec durations across 2 shards', () => {
    const specs = [
      'tests/auth/login.spec.ts', // 60s
      'tests/checkout/cart.spec.ts', // 40s
      'tests/user/profile.spec.ts', // 30s
      'tests/home/landing.spec.ts', // 10s
    ];

    const mockDurations: SpecDurationMap = {
      'tests/auth/login.spec.ts': 60000,
      'tests/checkout/cart.spec.ts': 40000,
      'tests/user/profile.spec.ts': 30000,
      'tests/home/landing.spec.ts': 10000,
    };

    const partitions = partitionSpecsLPT(specs, 2, mockDurations);

    expect(partitions.length).toBe(2);
    // Shard 1 should get 60s + 10s = 70s, Shard 2 should get 40s + 30s = 70s (Perfect balance!)
    expect(partitions[0].totalDurationMs).toBe(70000);
    expect(partitions[1].totalDurationMs).toBe(70000);
  });

  test('falls back gracefully to default duration when no history exists', () => {
    const specs = ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/c.spec.ts'];
    const partitions = partitionSpecsLPT(specs, 3, {}, 10000);

    expect(partitions.length).toBe(3);
    for (const p of partitions) {
      expect(p.specs.length).toBe(1);
      expect(p.totalDurationMs).toBe(10000);
    }
  });
});
