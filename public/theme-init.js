// Runs before the stylesheet and React, using the existing renderer preference key.
(() => {
  let theme = 'system';
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // A blocked store still permits the current Windows theme.
  }
  document.documentElement.dataset.theme =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
})();
