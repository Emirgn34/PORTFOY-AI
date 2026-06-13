import { NavLink } from 'react-router-dom';
import { Wallet, Eye, Newspaper, Activity, BrainCircuit, TrendingUp, X, Shield, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { signOut } from '../services/auth.js';

const NAV_ITEMS = [
  { to: '/portfolio', label: 'Portföyüm', icon: Wallet },
  { to: '/watchlist', label: 'İzleme Listesi', icon: Eye },
  { to: '/news', label: 'Haberler & Gelişmeler', icon: Newspaper },
  { to: '/opportunities', label: 'Fırsatlar', icon: Activity },
  { to: '/analysis', label: 'Portföy Yorumu', icon: BrainCircuit },
];

export default function Sidebar({ isOpen, onClose }) {
  const { configured, isAuthenticated, isAdmin, username } = useAuth();
  const navItems = isAdmin ? [...NAV_ITEMS, { to: '/admin', label: 'Kullanıcı Yönetimi', icon: Shield }] : NAV_ITEMS;

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
          {navItems.map(({ to, label, icon: Icon }) => (
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
          {configured && isAuthenticated && (
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                    isAdmin ? 'bg-accent/20 text-accent-soft' : 'bg-navy-800 text-slate-300'
                  }`}
                >
                  {(username ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="overflow-hidden">
                  <p className="truncate text-xs font-medium text-slate-200">{username}</p>
                  <p className="text-[10px] text-slate-500">{isAdmin ? 'Yönetici' : 'Kullanıcı'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => signOut()}
                title="Çıkış yap"
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-slate-400 hover:bg-navy-800 hover:text-white"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-slate-600">
            Buradaki bilgiler yatırım tavsiyesi değildir.
          </p>
        </div>
      </aside>
    </>
  );
}
