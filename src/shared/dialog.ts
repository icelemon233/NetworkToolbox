import { useEffect, useRef } from 'react';

export function useModalDialog(open = true, returnFocus?: HTMLElement | null) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previous = returnFocus ?? document.activeElement;
    node.showModal();
    return () => {
      node.close();
      // Conditional unmount can remove a dialog before its native focus restoration runs.
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected)
        previous.focus();
    };
  }, [open, returnFocus]);
  return ref;
}
