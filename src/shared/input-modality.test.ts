// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { installInputModality } from './input-modality';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  delete document.documentElement.dataset.inputModality;
});
it('switches keyboard to pointer on the same focused button without discarding focus', () => {
  dispose = installInputModality();
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  fireEvent.keyDown(button, { key: 'Tab' });
  expect(document.documentElement.dataset.inputModality).toBe('keyboard');
  fireEvent.pointerDown(button);
  expect(document.documentElement.dataset.inputModality).toBe('pointer');
  expect(document.activeElement).toBe(button);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) fireEvent.keyDown(button, { key });
  fireEvent.keyDown(button, { key: 'c', ctrlKey: true });
  fireEvent.keyDown(button, { key: 'ArrowLeft', altKey: true });
  expect(document.documentElement.dataset.inputModality).toBe('pointer');
  fireEvent.keyDown(button, { key: 'Tab', shiftKey: true });
  expect(document.documentElement.dataset.inputModality).toBe('keyboard');
});
