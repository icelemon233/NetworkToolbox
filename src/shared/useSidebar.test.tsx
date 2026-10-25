// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSidebar } from './useSidebar';
import { markPointerInput } from './input-modality';

function Harness({ narrow = false }: { narrow?: boolean }) {
  const sidebar = useSidebar(narrow, () => {});
  return (
    <>
      <aside
        ref={sidebar.ref}
        {...sidebar.events}
        data-testid="sidebar"
        data-expanded={sidebar.expanded}
      >
        <button aria-label="设置">设置</button>
        <button aria-label="固定偏好" aria-pressed={sidebar.pinned} onClick={sidebar.togglePin}>
          图钉
        </button>
        <button aria-label="导航菜单" aria-expanded="false">
          菜单
        </button>
      </aside>
      <button>工作区</button>
    </>
  );
}
const region = () => screen.getByTestId('sidebar');
const expanded = () => region().dataset.expanded === 'true';
const waitForHide = () => act(() => vi.advanceTimersByTime(151));
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset.inputModality;
});

it('preserves the existing preference key and collapses after a mouse click leaves focus behind', () => {
  render(<Harness />);
  const pin = screen.getByRole('button', { name: '固定偏好' });
  fireEvent.pointerEnter(region());
  fireEvent.pointerDown(pin);
  act(() => pin.focus());
  fireEvent.click(pin);
  fireEvent.pointerUp(pin);
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  expect(expanded()).toBe(true);
  fireEvent.pointerLeave(region());
  act(() => vi.advanceTimersByTime(149));
  expect(expanded()).toBe(true);
  act(() => vi.advanceTimersByTime(2));
  expect(expanded()).toBe(false);
  expect(document.activeElement).toBe(pin);
});

it('opens temporarily on hover and restores only the pin state when reopened', () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  const view = render(<Harness />);
  expect(expanded()).toBe(false);
  fireEvent.pointerEnter(region());
  expect(expanded()).toBe(true);
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  view.unmount();
  render(<Harness />);
  expect(expanded()).toBe(false);
});

it('drops temporary hover state when switching to and from the navigation drawer', () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  const view = render(<Harness />);
  fireEvent.pointerEnter(region());
  expect(expanded()).toBe(true);
  view.rerender(<Harness narrow />);
  view.rerender(<Harness />);
  expect(expanded()).toBe(false);
  expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
});

it('holds keyboard focus, ignores modifier-only keys and releases on pointer input without blurring', () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  render(<Harness />);
  const settings = screen.getByRole('button', { name: '设置' });
  fireEvent.keyDown(document, { key: 'Tab' });
  act(() => settings.focus());
  expect(expanded()).toBe(true);
  fireEvent.pointerLeave(region());
  fireEvent.keyDown(document, { key: 'Shift' });
  waitForHide();
  expect(expanded()).toBe(true);
  fireEvent.pointerDown(screen.getByRole('button', { name: '工作区' }));
  waitForHide();
  expect(expanded()).toBe(false);
  expect(document.activeElement).toBe(settings);
});

it('keeps the overlay while a menu is open and closes once it is dismissed', async () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  render(<Harness />);
  fireEvent.pointerEnter(region());
  const menu = screen.getByRole('button', { name: '导航菜单' });
  menu.setAttribute('aria-expanded', 'true');
  fireEvent.pointerLeave(region());
  waitForHide();
  expect(expanded()).toBe(true);
  await act(async () => {
    menu.setAttribute('aria-expanded', 'false');
  });
  waitForHide();
  expect(expanded()).toBe(false);
});

it('keeps a drag alive outside the sidebar until the drag finishes', () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  render(<Harness />);
  fireEvent.pointerEnter(region());
  fireEvent.dragStart(region());
  fireEvent.pointerLeave(region());
  waitForHide();
  expect(expanded()).toBe(true);
  fireEvent.dragEnd(document);
  waitForHide();
  expect(expanded()).toBe(false);
});

it('releases an overlay held by keyboard focus when a native caption receives a pointer click', () => {
  localStorage.setItem('sidebar-collapsed', 'true');
  render(<Harness />);
  const settings = screen.getByRole('button', { name: '设置' });
  fireEvent.keyDown(document, { key: 'Tab' });
  act(() => settings.focus());
  fireEvent.pointerLeave(region());
  waitForHide();
  expect(expanded()).toBe(true);
  act(() => markPointerInput());
  waitForHide();
  expect(expanded()).toBe(false);
  expect(document.activeElement).toBe(settings);
});
