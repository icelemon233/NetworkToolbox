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
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { useApp } from './shared/context';
import { bridge, isPreview, isDesktop } from './shared/bridge';
import { readPreference, savePreference } from './shared/preferences';
import { useModalDialog } from './shared/dialog';
import { Select, ErrorNotice } from './shared/ui';
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
function SidebarContent({ id, onNavigate }: { id: string; onNavigate?: () => void }) {
  const app = useApp();
  const activeJobs = app.jobs.filter((j) => j.state === 'running').length;
  function go(page: string) {
    app.go(page);
    onNavigate?.();
  }
  return (
    <>
      <nav id={id} aria-label="工具导航">
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
                onClick={() => go(item.id)}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
                {item.id === 'tasks' && activeJobs > 0 && <b className="nav-count">{activeJobs}</b>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${app.page === 'settings' ? 'active' : ''}`}
          aria-label="应用设置"
          aria-current={app.page === 'settings' ? 'page' : undefined}
          title="应用设置"
          onClick={() => go('settings')}
        >
          <Settings size={18} />
          <span>应用设置</span>
          <small>{productVersion}</small>
        </button>
      </div>
    </>
  );
}
export default function App() {
  const app = useApp();
  const [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [navigationOpen, setNavigationOpen] = useState(false),
    [narrow, setNarrow] = useState(() => matchMedia('(max-width: 700px)').matches),
    [compact, setCompact] = useState(() => matchMedia('(max-width: 1040px)').matches),
    [sidebarPreference, setSidebarPreference] = useState<boolean | null>(() => {
      const saved = readPreference('sidebar-collapsed');
      return saved === null ? null : saved === 'true';
    });
  const collapsed = narrow || (sidebarPreference ?? compact);
  const searchDialog = useModalDialog(searchOpen);
  const navigationDialog = useModalDialog(navigationOpen && narrow);
  const results = useRef<HTMLDivElement>(null);
  function closeSearch() {
    setSearchOpen(false);
    setSearch('');
  }
  function openPage(id: string) {
    app.go(id);
    closeSearch();
  }
  useEffect(() => {
    const mq = matchMedia('(max-width: 1040px)');
    const update = () => setCompact(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const mq = matchMedia('(max-width: 700px)');
    const update = () => {
      setNarrow(mq.matches);
      setNavigationOpen(false);
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const activeJobs = app.jobs.filter((j) => j.state === 'running').length;
  const Page = pages[app.page] ?? OverviewPage;
  const all = [
    ...groups.flatMap((g) => g.items),
    { id: 'settings', label: '应用设置', icon: Settings },
  ].filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNavigationOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    document.querySelector('.main-scroll')?.scrollTo(0, 0);
  }, [app.page]);
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="window-titlebar">
        <img src={appIcon} alt="" />
        <span>{productName}</span>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <SidebarContent id="tool-navigation" />
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                title={collapsed ? '展开侧栏' : '收起侧栏'}
                aria-expanded={narrow ? navigationOpen : !collapsed}
                aria-controls={narrow ? 'tool-navigation-drawer' : 'tool-navigation'}
                onClick={() => {
                  if (narrow) {
                    setNavigationOpen(true);
                    return;
                  }
                  const next = !collapsed;
                  setSidebarPreference(next);
                  if (!savePreference('sidebar-collapsed', String(next)))
                    app.notify('侧栏已切换，但无法保存偏好');
                }}
              >
                {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
              <button
                className="tool-search"
                aria-label="查找工具"
                title="查找工具（Ctrl + K）"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={18} />
                <span>查找工具</span>
                <kbd>Ctrl + K</kbd>
              </button>
            </div>
            <div className="topbar-right">
              {app.overview && (
                <div className="adapter-picker">
                  <span
                    className={`status-dot ${app.overview.adapters.find((a) => a.id === app.adapterId)?.status === 'Up' ? '' : 'off'}`}
                  />
                  <Select
                    aria-label="当前网络适配器"
                    value={app.adapterId}
                    onValueChange={(selectedValue) => app.setAdapterId(selectedValue)}
                  >
                    {!app.overview.adapters.length && <option value="">没有可用适配器</option>}
                    {app.overview.adapters.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.status === 'Up' ? ' · 已连接' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
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
                title="进入托盘"
                aria-label="进入托盘"
                disabled={!isDesktop}
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
              <ErrorNotice error={app.error || app.overviewError} />
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
      </div>
      {narrow && navigationOpen && (
        <dialog
          ref={navigationDialog}
          className="sidebar navigation-dialog"
          aria-labelledby="navigation-title"
          onCancel={() => setNavigationOpen(false)}
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setNavigationOpen(false);
          }}
        >
          <div className="dialog-head">
            <h2 id="navigation-title">工具导航</h2>
            <button
              className="icon-button"
              aria-label="收起侧栏"
              title="收起侧栏"
              onClick={() => setNavigationOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <SidebarContent id="tool-navigation-drawer" onNavigate={() => setNavigationOpen(false)} />
        </dialog>
      )}
      {searchOpen && (
        <dialog
          ref={searchDialog}
          className="search-backdrop"
          aria-label="查找工具"
          onCancel={closeSearch}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSearch();
          }}
        >
          <div className="command-dialog">
            <div className="command-input">
              <Search size={19} />
              <input
                aria-label="工具名称"
                placeholder="查找网络工具…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && all[0]) openPage(all[0].id);
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const buttons = results.current?.querySelectorAll('button');
                    buttons?.[e.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus();
                  }
                }}
              />
              <kbd>Esc</kbd>
              <button className="icon-button" aria-label="关闭工具搜索" onClick={closeSearch}>
                <X size={18} />
              </button>
            </div>
            <div
              className="command-results"
              ref={results}
              onKeyDown={(e) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
                e.preventDefault();
                const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
                const index = buttons.indexOf(e.target as HTMLButtonElement);
                if (e.key === 'ArrowUp' && index === 0) {
                  searchDialog.current?.querySelector('input')?.focus();
                  return;
                }
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? buttons.length - 1
                      : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              {all.map((i) => (
                <button key={i.id} onClick={() => openPage(i.id)}>
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
