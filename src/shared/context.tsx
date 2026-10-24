import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { bridge } from './bridge';
import { row, text, type Overview, type WifiScan, type Job } from './models';
interface AppState {
  overview: Overview | null;
  wifi: WifiScan | null;
  refresh: () => Promise<void>;
  scan: () => Promise<void>;
  scanning: boolean;
  error: string;
  setError: (e: string) => void;
  jobs: Job[];
  samples: Record<string, unknown[]>;
  notify: (s: string) => void;
  page: string;
  go: (p: string) => void;
  adapterId: string;
  setAdapterId: (id: string) => void;
  rates: { time: number; down: number; up: number }[];
  theme: string;
  setTheme: (s: string) => void;
}
const Context = createContext<AppState | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [wifi, setWifi] = useState<WifiScan | null>(null),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState(''),
    [jobs, setJobs] = useState<Job[]>([]),
    [samples, setSamples] = useState<Record<string, unknown[]>>({}),
    [toast, setToast] = useState(''),
    [page, setPage] = useState('overview'),
    [adapterId, setAdapterId] = useState(''),
    [rates, setRates] = useState<{ time: number; down: number; up: number }[]>([]),
    [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'system');
  const selected = useRef(adapterId);
  selected.current = adapterId;
  const previous = useRef<{ id: string; time: number; down: number; up: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    previous.current = null;
    setRates([]);
  }, [adapterId]);
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    try {
      const next = await bridge.call<Overview>('overview');
      if (!mounted.current) return;
      setOverview(next);
      const adapter =
        next.adapters.find((a) => a.id === selected.current) ??
        next.adapters.find((a) => a.status === 'Up' && a.gateways.length > 0) ??
        next.adapters[0];
      if (adapter) {
        if (!selected.current) setAdapterId(adapter.id);
        const now = Date.now(),
          last = previous.current;
        if (
          last &&
          last.id === adapter.id &&
          adapter.receivedBytes !== null &&
          adapter.sentBytes !== null
        ) {
          const elapsed = (now - last.time) / 1000;
          if (elapsed > 0)
            setRates((v) =>
              [
                ...v,
                {
                  time: now,
                  down: Math.max(0, (adapter.receivedBytes! - last.down) / elapsed),
                  up: Math.max(0, (adapter.sentBytes! - last.up) / elapsed),
                },
              ].slice(-90),
            );
        }
        previous.current = {
          id: adapter.id,
          time: now,
          down: adapter.receivedBytes ?? 0,
          up: adapter.sentBytes ?? 0,
        };
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '读取本机网络失败');
    }
  }, []);
  const scan = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      const result = await bridge.call<WifiScan>('wifi.scan', { refresh: true });
      setWifi(result);
      notify('无线扫描已更新');
    } catch (e) {
      setError(e instanceof Error ? e.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  }, [notify]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    void bridge
      .call<Job[]>('jobs.list')
      .then(setJobs)
      .catch(() => {});
    void bridge
      .call<WifiScan>('wifi.scan', { refresh: false })
      .then(setWifi)
      .catch(() => {});
    const timer = setInterval(() => void refresh(), 3000);
    const off = bridge.onEvent((event) => {
      if (event.name === 'job') {
        const job = event.data as Job;
        setJobs((v) => [job, ...v.filter((j) => j.id !== job.id)]);
        if (job.state === 'failed') notify(job.error ?? '任务未完成');
      } else if (event.name === 'sample') {
        const data = row(event.data),
          id = text(data.jobId, '');
        setSamples((v) => ({ ...v, [id]: [...(v[id] ?? []), data.data].slice(-2000) }));
        setJobs((v) =>
          v.map((j) =>
            j.id === id
              ? { ...j, progress: typeof data.progress === 'number' ? data.progress : j.progress }
              : j,
          ),
        );
      } else if (event.name === 'navigate') setPage(text(row(event.data).page, 'tasks'));
      else if (event.name === 'offline') setError('本机服务已关闭，请重新启动应用');
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      off();
    };
  }, [refresh, notify]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem('theme', theme);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const go = (p: string) => {
    setPage(p);
    setError('');
  };
  return (
    <Context.Provider
      value={{
        overview,
        wifi,
        refresh,
        scan,
        scanning,
        error,
        setError,
        jobs,
        samples,
        notify,
        page,
        go,
        adapterId,
        setAdapterId,
        rates,
        theme,
        setTheme,
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="关闭通知" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('App provider missing');
  return value;
}
export function useJob(kind: string) {
  const { jobs, samples } = useApp();
  const [id, setId] = useState('');
  const job = jobs.find((j) => j.id === id) ?? jobs.find((j) => j.kind === kind);
  return { job, samples: job ? (samples[job.id] ?? []) : [], setId };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [data, setData] = useState<unknown>(null);
  const { notify } = useApp();
  async function run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    setError('');
    try {
      const value = await action();
      setData(value);
      if (success) notify(success);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成');
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, data, setData, run };
}
