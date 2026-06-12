import { NavLink } from 'react-router-dom';
import { Wallet, Eye, Newspaper, Activity, BrainCircuit, TrendingUp, X } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/portfolio', label: 'Portföyüm', icon: Wallet },
  { to: '/watchlist', label: 'İzleme Listesi', icon: Eye },
  { to: '/news', label: 'Haberler & Gelişmeler', icon: Newspaper },
  { to: '/opportunities', label: 'Fırsatlar', icon: Activity },
  { to: '/analysis', label: 'Portföy Yorumu', icon: BrainCircuit },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {/* Mobil overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-navy-700/60 bg-navy-900 transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-navy-700/60 px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent-soft">
              <TrendingUp size={20} />
            </span>
            <span className="text-lg font-bold tracking-tight text-white">
              Portföy<span className="text-accent-soft">AI</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white lg:hidden"
            aria-label="Menüyü kapat"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent-soft'
                    : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-navy-700/60 px-5 py-4">
          <p className="text-xs text-slate-500">v0.1 — Demo / mock veri</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            Buradaki bilgiler yatırım tavsiyesi değildir.
          </p>
        </div>
      </aside>
    </>
  );
}
