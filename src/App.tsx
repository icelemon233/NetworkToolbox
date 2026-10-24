import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Wifi,
  Activity,
  Search,
  Gauge,
  Network,
  ArrowLeftRight,
  Settings2,
  Router,
  ScanLine,
  Wrench,
  History,
  ListTodo,
  Settings,
  ArrowDownToLine,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from './shared/context';
import { bridge, isPreview } from './shared/bridge';
import { ErrorNotice } from './shared/ui';
import { productName, productVersion } from './shared/product';
import appIcon from '../assets/icon.png';
import { OverviewPage } from './features/Overview';
import { WifiPage } from './features/Wifi';
import { DiagnosticsPage, DnsPage } from './features/Diagnostics';
import { SpeedPage } from './features/Speed';
import { LanPage, ConnectionsPage } from './features/LocalNetwork';
import { ConfigurationPage } from './features/Configuration';
import { RouterPage } from './features/Router';
import { CapturePage } from './features/Capture';
import { ToolsPage } from './features/Tools';
import { HistoryPage, TasksPage, SettingsPage } from './features/History';
const groups = [
  {
    label: '连接与检测',
    items: [
      { id: 'overview', label: '网络总览', icon: LayoutDashboard },
      { id: 'wifi', label: '无线信道', icon: Wifi },
      { id: 'diagnostics', label: '连通性诊断', icon: Activity },
      { id: 'dns', label: 'DNS 查询', icon: Search },
      { id: 'speed', label: '网络测速', icon: Gauge },
      { id: 'lan', label: '局域网设备', icon: Network },
      { id: 'connections', label: '进程连接', icon: ArrowLeftRight },
    ],
  },
  {
    label: '配置与工具',
    items: [
      { id: 'config', label: '本机网络配置', icon: Settings2 },
      { id: 'router', label: '小米路由器', icon: Router },
      { id: 'capture', label: '数据包捕获', icon: ScanLine },
      { id: 'tools', label: '常用工具', icon: Wrench },
    ],
  },
  {
    label: '记录',
    items: [
      { id: 'history', label: '历史与对比', icon: History },
      { id: 'tasks', label: '后台任务', icon: ListTodo },
    ],
  },
];
const names = Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.id, i.label])));
const pages: Record<string, () => React.JSX.Element> = {
  overview: OverviewPage,
  wifi: WifiPage,
  diagnostics: DiagnosticsPage,
  dns: DnsPage,
  speed: SpeedPage,
  lan: LanPage,
  connections: ConnectionsPage,
  config: ConfigurationPage,
  router: RouterPage,
  capture: CapturePage,
  tools: ToolsPage,
  history: HistoryPage,
  tasks: TasksPage,
  settings: SettingsPage,
};
export default function App() {
  const app = useApp();
  const [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false);
  const searchDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = searchDialog.current;
    if (searchOpen) node?.showModal();
    return () => node?.close();
  }, [searchOpen]);
  const activeJobs = app.jobs.filter((j) => j.state === 'running').length;
  const Page = pages[app.page] ?? OverviewPage;
  const all = groups
    .flatMap((g) => g.items)
    .filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    document.querySelector('.main-scroll')?.scrollTo(0, 0);
  }, [app.page]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => app.go('overview')}
          aria-label={`${productName} 首页`}
        >
          <img className="brand-symbol" src={appIcon} alt="" />
          <strong>{productName}</strong>
        </button>
        <button className="tool-search" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>查找工具</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="工具导航">
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  aria-current={app.page === item.id ? 'page' : undefined}
                  title={item.label}
                  className={`nav-item ${app.page === item.id ? 'active' : ''}`}
                  onClick={() => app.go(item.id)}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.id === 'tasks' && activeJobs > 0 && (
                    <b className="nav-count">{activeJobs}</b>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <ShieldCheck size={15} />
            <span>数据保存在本机</span>
          </div>
          <button
            className={`nav-item ${app.page === 'settings' ? 'active' : ''}`}
            aria-label="应用设置"
            onClick={() => app.go('settings')}
          >
            <Settings size={18} />
            <span>应用设置</span>
            <small>{productVersion}</small>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工具箱</span>
            <i>/</i>
            <strong>{names[app.page] ?? '应用设置'}</strong>
          </div>
          <div className="topbar-right">
            {app.overview && (
              <label className="adapter-picker">
                <span className="status-dot" />
                <select
                  aria-label="当前网络适配器"
                  value={app.adapterId}
                  onChange={(e) => app.setAdapterId(e.target.value)}
                >
                  {app.overview.adapters.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.status === 'Up' ? ' · 已连接' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="topbar-divider" />
            <button
              className="icon-button"
              title="后台任务"
              aria-label="打开后台任务"
              onClick={() => app.go('tasks')}
            >
              <ListTodo size={17} />
              {activeJobs > 0 && <span className="icon-count">{activeJobs}</span>}
            </button>
            <button
              className="icon-button"
              title="最小化到托盘"
              aria-label="最小化到托盘"
              onClick={() => void bridge.window('tray')}
            >
              <ArrowDownToLine size={17} />
            </button>
          </div>
        </header>
        <main className="main-scroll">
          <div className="page-content">
            {isPreview && (
              <div className="preview-note">
                Windows 真实数据预览 · 配置修改与文件导出请在桌面应用中操作
              </div>
            )}
            <ErrorNotice error={app.error} />
            <Page />
          </div>
          <footer className="app-footer">
            <span>
              <i className="status-dot" />
              本机数据 · Windows 原生采集
            </span>
            <span>联网测试由你手动开始</span>
          </footer>
        </main>
      </div>
      {searchOpen && (
        <dialog
          ref={searchDialog}
          className="search-backdrop"
          aria-label="查找工具"
          onCancel={() => setSearchOpen(false)}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <div className="command-dialog">
            <label className="command-input">
              <Search size={19} />
              <input
                autoFocus
                aria-label="工具名称"
                placeholder="查找网络工具…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && all[0]) {
                    app.go(all[0].id);
                    setSearchOpen(false);
                    setSearch('');
                  }
                }}
              />
              <kbd>Esc</kbd>
            </label>
            <div className="command-results">
              {all.map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    app.go(i.id);
                    setSearchOpen(false);
                    setSearch('');
                  }}
                >
                  <i.icon size={18} />
                  <span>{i.label}</span>
                  <small>打开工具</small>
                </button>
              ))}
              {!all.length && <p>没有匹配的工具</p>}
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
