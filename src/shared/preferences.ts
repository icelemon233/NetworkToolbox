export type Theme = 'system' | 'light' | 'dark';
export type CloseBehavior = 'tray' | 'quit';

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePreference(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readTheme(): Theme {
  const value = readPreference('theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
