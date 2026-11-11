// Applies the saved theme before first paint so there is no light/dark flash. Kept as a file (not inline) so the strict CSP can forbid inline scripts.
try {
  var t = localStorage.getItem('circle.theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
