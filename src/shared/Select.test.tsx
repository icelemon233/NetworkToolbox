// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

// JSDOM has no layout or pointer capture; placement and clipping are checked in Chromium.
beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1024 });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 768 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === document.documentElement
      ? new DOMRect(0, 0, 1024, 768)
      : new DOMRect(20, 20, 160, 36);
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

function Protocol({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('all');
  return (
    <Select aria-label="协议" value={value} onValueChange={setValue} disabled={disabled}>
      <option value="all">所有协议</option>
      <option>TCP</option>
      <option disabled>不可用</option>
      <option>UDP</option>
    </Select>
  );
}

describe('Select interaction contract', () => {
  it('selects an option by pointer and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Protocol />);
    const trigger = screen.getByRole('combobox', { name: '协议' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'TCP' }));
    expect(trigger.textContent).toBe('TCP');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports keyboard selection, skips disabled options, and cancels with Escape', async () => {
    const user = userEvent.setup();
    render(<Protocol />);
    const trigger = screen.getByRole('combobox', { name: '协议' });
    trigger.focus();
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');
    expect(trigger.textContent).toBe('UDP');
    await user.keyboard('{Enter}{ArrowUp}{Escape}');
    expect(trigger.textContent).toBe('UDP');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps numeric option values usable by callers and native forms', async () => {
    const user = userEvent.setup();
    function Form() {
      const [value, setValue] = useState(32);
      return (
        <form aria-label="下载">
          <Select
            name="size"
            aria-label="数据量"
            value={value}
            onValueChange={(v) => setValue(Number(v))}
          >
            {[32, 64].map((n) => (
              <option key={n} value={n}>
                {n} MB
              </option>
            ))}
          </Select>
        </form>
      );
    }
    render(<Form />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: '64 MB' }));
    const form = screen.getByRole('form') as HTMLFormElement;
    expect(new FormData(form).get('size')).toBe('64');
  });

  it('retains required validation and focuses the visible control', async () => {
    const user = userEvent.setup();
    function Form() {
      const [value, setValue] = useState('');
      return (
        <form aria-label="记录比较">
          <label>
            记录
            <Select required value={value} onValueChange={setValue} name="record">
              <option value="">选择记录</option>
              <option value="first">第一次检测</option>
            </Select>
          </label>
          <button type="submit">比较</button>
        </form>
      );
    }
    render(<Form />);
    const form = screen.getByRole('form') as HTMLFormElement;
    const trigger = screen.getByRole('combobox', { name: '记录' });
    // reportValidity dispatches the same native invalid event as submitting the form.
    expect(form.reportValidity()).toBe(false);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '请选择一项');
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '第一次检测' }));
    expect(form.checkValidity()).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not open a disabled or empty selector', () => {
    const { rerender } = render(<Protocol disabled />);
    fireEvent.pointerDown(screen.getByRole('combobox'), { button: 0, pointerType: 'mouse' });
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(
      <Select value="" onValueChange={vi.fn()}>
        <option value="">没有记录</option>
      </Select>,
    );
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
  });
});
