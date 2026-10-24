// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useModalDialog } from './dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('returns focus to the opener when a conditional modal is unmounted', async () => {
  // JSDOM does not implement native dialog focus, so model only its entry behavior.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
      this.querySelector('button')?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
  const user = userEvent.setup();
  function Modal({ onClose }: { onClose: () => void }) {
    const ref = useModalDialog();
    return (
      <dialog ref={ref} aria-label="工具搜索">
        <button onClick={onClose}>关闭搜索</button>
      </dialog>
    );
  }
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>查找工具</button>
        {open && <Modal onClose={() => setOpen(false)} />}
      </>
    );
  }
  render(<Harness />);
  const opener = screen.getByRole('button', { name: '查找工具' });
  await user.click(opener);
  const close = screen.getByRole('button', { name: '关闭搜索' });
  expect(document.activeElement).toBe(close);
  await user.click(close);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
