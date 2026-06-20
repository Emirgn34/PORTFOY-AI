import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Eye, Newspaper, TrendingUp, LineChart, X, Shield, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { signOut } from '../services/auth.js';

const NAV_ITEMS = [
  { to: '/portfolio', label: 'Portföy Özeti', icon: LayoutDashboard },
  { to: '/opportunities', label: 'Fırsatlar', icon: TrendingUp },
  { to: '/analysis', label: 'Portföy Analizi', icon: LineChart },
  { to: '/news', label: 'Haberler', icon: Newspaper },
  { to: '/watchlist', label: 'Takip Listesi', icon: Eye },
];

export default function Sidebar({ isOpen, onClose }) {
  const { configured, isAuthenticated, isAdmin, username } = useAuth();
  const navItems = isAdmin
    ? [...NAV_ITEMS, { to: '/admin', label: 'Kullanıcı Yönetimi', icon: Shield }]
    : NAV_ITEMS;

  return (
    <>
      {/* Mobil overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-navy-700 bg-navy-900 transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-navy-700 px-5">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="PortföyAI logosu" className="h-9 w-9 object-contain" />
            <span className="text-base font-semibold tracking-tight text-ink">
              Portföy<span className="text-accent">AI</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-navy-800 hover:text-ink lg:hidden"
            aria-label="Menüyü kapat"
          >
            <X size={18} />
          </button>
        </div>

        <nav data-tour="sidebar-nav" className="flex-1 space-y-0.5 px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Menü
          </p>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/12 font-semibold text-accent-soft'
                    : 'font-medium text-slate-400 hover:bg-navy-800 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} className={isActive ? 'text-accent' : 'text-slate-500 group-hover:text-slate-400'} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-navy-700 px-4 py-4">
          {configured && isAuthenticated && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-navy-700 bg-navy-950 p-2">
              <NavLink
                to="/account"
                onClick={onClose}
                title="Hesabım"
                className="flex items-center gap-2.5 overflow-hidden rounded-md p-0.5 transition-colors hover:opacity-80"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                    isAdmin ? 'bg-accent/15 text-accent' : 'bg-navy-800 text-slate-300'
                  }`}
                >
                  {(username ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="overflow-hidden">
                  <p className="truncate text-xs font-semibold text-ink">{username}</p>
                  <p className="text-[10px] text-slate-500">{isAdmin ? 'Yönetici' : 'Kullanıcı'}</p>
                </div>
              </NavLink>
              <button
                type="button"
                onClick={() => signOut()}
                title="Çıkış yap"
                aria-label="Çıkış yap"
                className="flex shrink-0 items-center gap-1 rounded-md p-2 text-slate-400 transition-colors hover:bg-navy-800 hover:text-loss"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">
            Buradaki bilgiler yatırım tavsiyesi niteliği taşımaz.
          </p>
        </div>
      </aside>
    </>
  );
}
