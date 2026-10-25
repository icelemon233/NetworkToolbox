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
  PanelLeftOpen,
  Pin,
  PinOff,
  X,
} from 'lucide-react';
import { useApp } from './shared/context';
import { bridge, isPreview, isDesktop, isUiQa } from './shared/bridge';
import { useSidebar } from './shared/useSidebar';
import { useModalDialog } from './shared/dialog';
import { Select, ErrorNotice } from './shared/ui';
import { row } from './shared/models';
import { markPointerInput } from './shared/input-modality';
import { productName } from './shared/product';
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
function SidebarContent({
  id,
  onNavigate,
  pinned,
  expanded = true,
  onTogglePin,
}: {
  id: string;
  onNavigate?: () => void;
  pinned?: boolean;
  expanded?: boolean;
  onTogglePin?: () => void;
}) {
  const app = useApp();
  const settings = useRef<HTMLButtonElement>(null);
  const pin = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded && pin.current === document.activeElement)
      settings.current?.focus({ preventScroll: true });
  }, [expanded]);
  const activeJobs = app.jobs.filter((j) => j.state === 'running').length;
  function go(page: string) {
    app.go(page);
    onNavigate?.();
  }
  return (
    <>
      <nav id={id} aria-label="工具导航">
        {groups.map((group) => (
          <div key={group.label} className="nav-group" role="group" aria-label={group.label}>
            {group.items.map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                aria-current={app.page === item.id ? 'page' : undefined}
                title={item.label}
                className={`nav-item ${app.page === item.id ? 'active' : ''}`}
                onClick={() => go(item.id)}
              >
                <span className="nav-icon">
                  <item.icon size={18} />
                </span>
                <span className="nav-text">{item.label}</span>
                {item.id === 'tasks' && activeJobs > 0 && <b className="nav-count">{activeJobs}</b>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          ref={settings}
          className={`nav-item settings-nav ${app.page === 'settings' ? 'active' : ''}`}
          aria-label="设置"
          aria-current={app.page === 'settings' ? 'page' : undefined}
          title="设置"
          onClick={() => go('settings')}
        >
          <span className="nav-icon">
            <Settings size={18} />
          </span>
          <span className="nav-text">设置</span>
        </button>
        {onTogglePin && (
          <button
            ref={pin}
            className="pin-toggle"
            hidden={!expanded}
            aria-label={pinned ? '取消固定侧栏' : '固定侧栏'}
            title={pinned ? '取消固定侧栏' : '固定侧栏'}
            aria-pressed={pinned}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
        )}
      </div>
    </>
  );
}
export default function App() {
  const app = useApp();
  const [maximized, setMaximized] = useState(false);
  const [caption, setCaption] = useState({ hovered: 0, pressed: 0 });
  useEffect(
    () =>
      bridge.onEvent((event) => {
        const data = row(event.data);
        if (
          event.name === 'window-pointer' ||
          (event.name === 'window-caption' && Number(data.pressed) !== 0)
        )
          markPointerInput();
        if (event.name === 'window-state') setMaximized(data.maximized === true);
        if (event.name === 'window-caption')
          setCaption({ hovered: Number(data.hovered), pressed: Number(data.pressed) });
      }),
    [],
  );
  const [search, setSearch] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [navigationOpen, setNavigationOpen] = useState(false),
    [narrow, setNarrow] = useState(() => matchMedia('(max-width: 700px)').matches);
  const sidebar = useSidebar(narrow, () => app.notify('侧栏已切换，但无法保存固定偏好'));
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
    { id: 'settings', label: '设置', icon: Settings },
  ].filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));
  const pageTitle =
    [...groups.flatMap((group) => group.items), { id: 'settings', label: '设置' }].find(
      (item) => item.id === app.page,
    )?.label ?? '网络总览';
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
    <div
      className={`app-shell ${!sidebar.pinned ? 'sidebar-unpinned' : ''} ${sidebar.expanded ? 'sidebar-expanded' : ''} ${narrow ? 'sidebar-narrow' : ''}`}
    >
      <header className="window-titlebar">
        <div className="titlebar-brand">
          <img src={appIcon} alt="" />
          <span>{productName}</span>
        </div>
        <div className="caption-controls">
          {(
            [
              ['minimize', 8, '最小化'],
              ['maximize', 9, maximized ? '还原' : '最大化'],
              ['close', 20, '关闭'],
            ] as const
          ).map(([action, hit, label]) => (
            <button
              key={action}
              className={`caption-control ${action === 'close' ? 'caption-close' : ''} ${caption.hovered === hit ? 'caption-hover' : ''} ${caption.pressed === hit && caption.hovered === hit ? 'caption-pressed' : ''}`}
              type="button"
              aria-label={label}
              title={label}
              disabled={!isDesktop}
              onClick={() => void bridge.window(action)}
            >
              <span
                className={`caption-glyph glyph-${action === 'maximize' && maximized ? 'restore' : action}`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </header>
      <div className="app-body">
        {!narrow && (
          <div className="sidebar-slot">
            <aside className="sidebar" ref={sidebar.ref} {...sidebar.events}>
              <SidebarContent
                id="tool-navigation"
                pinned={sidebar.pinned}
                expanded={sidebar.expanded}
                onTogglePin={sidebar.togglePin}
              />
            </aside>
          </div>
        )}
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-left">
              {narrow && (
                <button
                  className="icon-button"
                  aria-label="展开工具导航"
                  title="展开工具导航"
                  aria-expanded={navigationOpen}
                  aria-controls="tool-navigation-drawer"
                  onClick={() => setNavigationOpen(true)}
                >
                  <PanelLeftOpen size={18} />
                </button>
              )}
              <h1>{pageTitle}</h1>
            </div>
            <div className="topbar-right">
              {isUiQa && <span className="business-status">界面验收 · 检测已停用</span>}
              <button
                className="icon-button tool-search"
                aria-label="查找工具"
                title="查找工具（Ctrl + K）"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={18} />
              </button>
              {app.overview && (
                <div className="adapter-picker">
                  <span
                    className={`status-dot business-status-dot ${app.overview.adapters.find((a) => a.id === app.adapterId)?.status === 'Up' ? '' : 'off'}`}
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
          <main className={`main-scroll ${app.page === 'settings' ? 'settings-scroll' : ''}`}>
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
                {isUiQa ? '隔离界面验收' : '本机数据 · Windows 原生采集'}
              </span>
              <span>{isUiQa ? '本机服务未启动' : '联网测试由你手动开始'}</span>
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
