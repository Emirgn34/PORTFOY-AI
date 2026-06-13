import { useLocation } from 'react-router-dom';
import { Menu, Database, Lightbulb } from 'lucide-react';
import { useTour } from '../tour/TourProvider.jsx';

const PAGE_TITLES = {
  '/portfolio': 'Portföyüm',
  '/watchlist': 'İzleme Listesi',
  '/news': 'Haberler & Gelişmeler',
  '/opportunities': 'Fırsatlar',
  '/analysis': 'Portföy Yorumu',
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
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-navy-700/60 bg-navy-900/90 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-slate-400 hover:bg-navy-800 hover:text-white lg:hidden"
          aria-label="Menüyü aç"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base font-semibold text-white sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-slate-500 md:block">{today}</span>
        <button
          type="button"
          data-tour="help-button"
          onClick={startTour}
          title="Site eğitimini tekrar başlat"
          aria-label="Site eğitimini tekrar başlat"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-400 transition-colors hover:bg-amber-400/20"
        >
          <Lightbulb size={15} />
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
          <Database size={12} />
          Demo Veri
        </span>
      </div>
    </header>
  );
}
