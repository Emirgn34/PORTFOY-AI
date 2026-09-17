import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const isDark = theme === 'dark';

  function toggleTheme() {
    const nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', nextTheme === 'dark' ? '#101815' : '#f6f7f4',
    );
    setTheme(nextTheme);
    try {
      localStorage.setItem('portfoyai_theme', nextTheme);
    } catch {
      // Depolama kapalıysa tema bu oturum boyunca kullanılabilir.
    }
  }

  return (
    <button
      type="button"
      data-tour="theme-toggle"
      onClick={toggleTheme}
      aria-label="Karanlık tema"
      aria-pressed={isDark}
      title={isDark ? 'Açık temaya geç' : 'Karanlık temaya geç'}
      className="mb-3 flex w-full items-center gap-3 rounded-lg border border-navy-700 bg-navy-950 px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-800 hover:text-ink"
    >
      {isDark ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      <span className="flex-1 text-left">{isDark ? 'Karanlık tema' : 'Açık tema'}</span>
      <span aria-hidden="true" className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 ${isDark ? 'bg-accent' : 'bg-navy-600'}`}>
        <span className={`h-4 w-4 rounded-full bg-navy-900 transition-transform motion-reduce:transition-none ${isDark ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}
