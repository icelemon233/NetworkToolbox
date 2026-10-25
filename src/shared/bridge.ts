import type { Bridge, NativeEvent } from './models';
const preview =
  new URLSearchParams(location.search).get('preview') === '1' && location.hostname === '127.0.0.1';
const listeners = new Set<(event: NativeEvent) => void>();
if (preview) {
  const stream = new EventSource('/api/events');
  stream.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as NativeEvent;
      listeners.forEach((fn) => fn(data));
    } catch {
      /* Ignore malformed preview events; they never become application data. */
    }
  };
}
export const bridge: Bridge = {
  async call<T>(method: string, params: Record<string, unknown> = {}) {
    if (window.networkToolbox) return window.networkToolbox.call<T>(method, params);
    if (!preview) throw new Error('请通过 Windows 桌面应用打开网络工具箱');
    const response = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Toolbox-Preview': '1' },
      body: JSON.stringify({ method, params }),
    });
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('本机服务返回格式错误');
    const data = payload as { error?: string; result?: T };
    if (data.error) throw new Error(data.error);
    return data.result as T;
  },
  onEvent(callback) {
    if (window.networkToolbox) return window.networkToolbox.onEvent(callback);
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  async exportRecord(id, kind) {
    if (window.networkToolbox) return window.networkToolbox.exportRecord(id, kind);
    throw new Error('请在桌面应用中导出文件');
  },
  async openExternal(url) {
    if (window.networkToolbox) return window.networkToolbox.openExternal(url);
    if (url.startsWith('https:') || url.startsWith('http:')) window.open(url, '_blank', 'noopener');
    else throw new Error('请在桌面应用中打开系统设置');
  },
  async window(action) {
    if (window.networkToolbox) return window.networkToolbox.window(action);
    throw new Error('窗口操作仅在 Windows 桌面应用中可用');
  },
  async getWindowPreferences() {
    if (window.networkToolbox) return window.networkToolbox.getWindowPreferences();
    return { theme: 'system', closeBehavior: 'tray' };
  },
  async setWindowPreferences(preferences) {
    if (window.networkToolbox) return window.networkToolbox.setWindowPreferences(preferences);
    return { theme: 'system', closeBehavior: 'tray' };
  },
};
export const isPreview = preview;
export const isDesktop = Boolean(window.networkToolbox);
export const isUiQa = window.networkToolbox?.uiQa === true;
