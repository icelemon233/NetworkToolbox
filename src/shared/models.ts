export interface Adapter {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  speedMbps: number;
  mac: string;
  index: number | null;
  addresses: { address: string; prefix: number; family: string }[];
  gateways: string[];
  dns: string[];
  receivedBytes: number | null;
  sentBytes: number | null;
}
export interface Connection {
  interfaceId: string;
  ssid: string;
  bssid: string;
  quality: number;
  receiveMbps: number;
  transmitMbps: number;
}
export interface Overview {
  timestamp: string;
  computerName: string;
  os: string;
  adapters: Adapter[];
  wifi: Connection[];
  wifiError: string | null;
  gateway: string | null;
  proxy: { enabled: boolean; server: string; pac: string };
}
export interface WifiNetwork {
  ssid: string;
  bssid: string;
  interfaceId: string;
  rssi: number;
  quality: number;
  frequency: number;
  channel: number;
  band: string;
  width: number | null;
  centerFrequency: number | null;
  utilization: number | null;
  stations: number | null;
  security: string;
  connected: boolean;
  protocol: string;
}
export interface WifiScan {
  timestamp: string;
  networks: WifiNetwork[];
  connections: Connection[];
  candidates: { channel: number; width: number; band: string; risk: number; reason: string }[];
  visibleNetworkCount: number;
  refreshed: boolean;
  notes: string[];
}
export interface Job {
  id: string;
  kind: string;
  title: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  progress: number;
  result: unknown;
  error: string | null;
}
export interface NativeEvent {
  name: string;
  data: unknown;
}
export interface WindowPreferences {
  theme: 'system' | 'light' | 'dark';
  closeBehavior: 'tray' | 'quit';
  error?: string;
}
export interface Bridge {
  readonly uiQa?: boolean;
  readonly initialTheme?: WindowPreferences['theme'];
  readonly nativeTheme?: 'light' | 'dark';
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(callback: (event: NativeEvent) => void): () => void;
  exportRecord(
    id: string,
    kind: 'report' | 'capture',
  ): Promise<{ saved?: boolean; cancelled?: boolean; path?: string }>;
  openExternal(url: string): Promise<void>;
  window(action: 'minimize' | 'maximize' | 'close' | 'tray' | 'quit'): Promise<void>;
  getWindowPreferences(): Promise<WindowPreferences>;
  setWindowPreferences(
    preferences: Partial<Pick<WindowPreferences, 'theme' | 'closeBehavior'>>,
  ): Promise<WindowPreferences>;
}
declare global {
  interface Window {
    networkToolbox?: Bridge;
  }
}
export type Row = Record<string, unknown>;
export function row(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function text(value: unknown, fallback = '—'): string {
  return value === null || value === undefined || value === ''
    ? fallback
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
}
export function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
export function date(value: unknown): string {
  const d = new Date(text(value, ''));
  return Number.isNaN(d.valueOf())
    ? '—'
    : d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}
