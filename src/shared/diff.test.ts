import { describe, it, expect } from 'vitest';
import { diffRecords } from './diff';
describe('history comparison', () => {
  it('matches reordered adapters by identity', () => {
    expect(
      diffRecords(
        {
          adapters: [
            { id: 'a', dns: ['1.1.1.1'] },
            { id: 'b', dns: [] },
          ],
        },
        {
          adapters: [
            { id: 'b', dns: [] },
            { id: 'a', dns: ['1.1.1.1'] },
          ],
        },
      ),
    ).toEqual([]);
  });
  it('preserves unknown versus zero and identifies real channel changes', () => {
    const diff = diffRecords(
      { networks: [{ bssid: 'ap', channel: 48, utilization: null }] },
      { networks: [{ bssid: 'ap', channel: 149, utilization: 0 }] },
    );
    expect(diff).toHaveLength(2);
    expect(diff.find((d) => d.path.endsWith('utilization'))?.before).toBe('未知');
    expect(diff.find((d) => d.path.endsWith('channel'))?.after).toBe('149');
  });
  it('does not include credentials or changing counters', () => {
    expect(
      diffRecords(
        { password: 'old', pwd1: 'old', token: 'a', timestamp: 't1', receivedBytes: 10 },
        { password: 'new', pwd1: 'new', token: 'b', timestamp: 't2', receivedBytes: 20 },
      ),
    ).toEqual([]);
  });
});
