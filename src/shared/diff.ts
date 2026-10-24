import { row } from './models';
export interface Difference {
  path: string;
  before: string;
  after: string;
}
const omitted = new Set([
  'timestamp',
  'createdAt',
  'id',
  'password',
  'token',
  'receivedBytes',
  'sentBytes',
]);
function flatten(
  value: unknown,
  path = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (Array.isArray(value)) {
    const key = ['bssid', 'id', 'server', 'mac'].find(
      (k) => value.length > 0 && value.every((v) => typeof row(v)[k] === 'string'),
    );
    for (let i = 0; i < value.length; i++)
      flatten(value[i], `${path}[${key ? String(row(value[i])[key]) : i}]`, out);
    if (!value.length) out[path] = '[]';
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (
        omitted.has(k) ||
        k.toLowerCase().startsWith('pwd') ||
        k.toLowerCase().includes('password')
      )
        continue;
      flatten(v, path ? `${path}.${k}` : k, out);
    }
  } else out[path] = value === null ? '未知' : String(value);
  return out;
}
export function diffRecords(before: unknown, after: unknown): Difference[] {
  const a = flatten(before),
    b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((k) => a[k] !== b[k])
    .map((path) => ({ path, before: a[path] ?? '不存在', after: b[path] ?? '不存在' }));
}
