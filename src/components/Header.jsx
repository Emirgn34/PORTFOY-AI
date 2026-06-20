import { useLocation } from 'react-router-dom';
import { Menu, Database, HelpCircle } from 'lucide-react';
import { useTour } from '../tour/TourProvider.jsx';

const PAGE_TITLES = {
  '/portfolio': 'Portföy Özeti',
  '/watchlist': 'Takip Listesi',
  '/news': 'Haberler ve Araştırma',
  '/opportunities': 'Fırsatlar',
  '/analysis': 'Portföy Analizi',
  '/account': 'Hesabım',
  '/admin': 'Kullanıcı Yönetimi',
};

export default function Header({ onMenuClick }) {
  const { pathname } = useLocation();
  const { startTour } = useTour();
  const title = PAGE_TITLES[pathname] ?? 'PortföyAI';

  const today = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(new Date());

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-navy-700 bg-navy-950/85 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-navy-800 hover:text-ink lg:hidden"
          aria-label="Menüyü aç"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {title}
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block">Son güncelleme · {today}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-navy-700 bg-navy-900 px-2.5 py-1 text-[11px] font-medium text-slate-500 md:inline-flex">
          <Database size={12} />
          Piyasa verisi
        </span>
        <button
          type="button"
          data-tour="help-button"
          onClick={startTour}
          title="Site tanıtım turunu başlat"
          aria-label="Site tanıtım turunu başlat"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-navy-700 bg-navy-900 text-slate-500 transition-colors hover:bg-navy-800 hover:text-ink"
        >
          <HelpCircle size={16} />
        </button>
      </div>
    </header>
  );
}
