import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { TourProvider } from '../tour/TourProvider.jsx';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <TourProvider>
    <div className="min-h-screen bg-navy-950">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen flex-col lg:pl-64">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-navy-700/60 px-6 py-4">
          <p className="text-center text-[11px] leading-relaxed text-slate-600">
            PortföyAI bir demo uygulamasıdır. Burada yer alan tüm veriler örnek (mock) verilerdir
            ve hiçbir içerik yatırım tavsiyesi değildir.
          </p>
        </footer>
      </div>
    </div>
    </TourProvider>
  );
}
