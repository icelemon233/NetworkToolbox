import { useCallback, useEffect, useRef, useState } from 'react';
import shell from '../../desktop/window-shell.json';
import { readPreference, savePreference } from './preferences';
import { isFocusNavigation } from './input-modality';

/** Only the pin preference is durable; pointer, keyboard and menu state belong to this window. */
export function useSidebar(narrow: boolean, onSaveError: () => void) {
  const [pinned, setPinned] = useState(() => readPreference('sidebar-collapsed') !== 'true');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const pointerInside = useRef(false);
  const pointerHeld = useRef(false);
  const dragging = useRef(false);
  const input = useRef<'pointer' | 'keyboard'>('pointer');
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelHide = useCallback(() => clearTimeout(hideTimer.current), []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      const keyboardInside =
        input.current === 'keyboard' &&
        document.documentElement.dataset.inputModality !== 'pointer' &&
        focused instanceof HTMLElement &&
        ref.current?.contains(focused) &&
        focused.matches(':focus-visible');
      const menuOpen = ref.current?.querySelector('[aria-expanded="true"], [data-state="open"]');
      if (
        !pointerInside.current &&
        !pointerHeld.current &&
        !dragging.current &&
        !keyboardInside &&
        !menuOpen
      )
        setOpen(false);
    }, shell.sidebar.hoverHideDelayMs);
  }, [cancelHide]);
  useEffect(() => {
    if (narrow) {
      cancelHide();
      pointerInside.current = false;
      pointerHeld.current = false;
      dragging.current = false;
      setOpen(false);
    }
  }, [narrow, cancelHide]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (isFocusNavigation(event)) {
        input.current = 'keyboard';
        if (ref.current?.contains(document.activeElement)) setOpen(true);
      }
    }
    function pointer(event: PointerEvent) {
      input.current = 'pointer';
      pointerHeld.current = ref.current?.contains(event.target as Node) ?? false;
      scheduleHide();
    }
    function release() {
      pointerHeld.current = false;
      scheduleHide();
    }
    function endDrag() {
      dragging.current = false;
      scheduleHide();
    }
    function nativePointer() {
      input.current = 'pointer';
      pointerInside.current = false;
      pointerHeld.current = false;
      scheduleHide();
    }
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('dragend', endDrag, true);
    document.addEventListener('drop', endDrag, true);
    document.addEventListener('toolbox:native-pointer', nativePointer);
    const observer = new MutationObserver(scheduleHide);
    if (ref.current)
      observer.observe(ref.current, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-expanded', 'data-state'],
      });
    return () => {
      cancelHide();
      observer.disconnect();
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('dragend', endDrag, true);
      document.removeEventListener('drop', endDrag, true);
      document.removeEventListener('toolbox:native-pointer', nativePointer);
    };
  }, [cancelHide, scheduleHide, narrow]);
  return {
    ref,
    pinned,
    expanded: !narrow && (pinned || open),
    togglePin() {
      const next = !pinned;
      setPinned(next);
      setOpen(!next && (pointerInside.current || input.current === 'keyboard'));
      if (!savePreference('sidebar-collapsed', String(!next))) onSaveError();
    },
    events: {
      onPointerEnter() {
        pointerInside.current = true;
        cancelHide();
        setOpen(true);
      },
      onPointerLeave() {
        pointerInside.current = false;
        scheduleHide();
      },
      onFocusCapture() {
        if (
          input.current === 'keyboard' &&
          document.documentElement.dataset.inputModality !== 'pointer'
        ) {
          cancelHide();
          setOpen(true);
        }
      },
      onBlurCapture: scheduleHide,
      onDragStartCapture() {
        dragging.current = true;
        cancelHide();
      },
    },
  };
}
