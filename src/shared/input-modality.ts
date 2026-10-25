export function isFocusNavigation(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
) {
  return (
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    [
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Enter',
      ' ',
    ].includes(event.key)
  );
}

export function installInputModality() {
  const root = document.documentElement;
  root.dataset.inputModality = 'pointer';
  const pointer = () => {
    root.dataset.inputModality = 'pointer';
  };
  const keyboard = (event: KeyboardEvent) => {
    if (isFocusNavigation(event)) root.dataset.inputModality = 'keyboard';
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', keyboard, true);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', keyboard, true);
  };
}

export function markPointerInput() {
  document.documentElement.dataset.inputModality = 'pointer';
  document.dispatchEvent(new Event('toolbox:native-pointer'));
}
