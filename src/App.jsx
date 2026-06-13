import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import WatchlistPage from './pages/WatchlistPage.jsx';
import NewsPage from './pages/NewsPage.jsx';
import OpportunitiesPage from './pages/OpportunitiesPage.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { useAuth } from './contexts/AuthContext.jsx';

/** Oturum çözümlenirken gösterilen tam ekran yükleme durumu. */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950">
      <Loader2 size={28} className="animate-spin text-accent-soft" />
    </div>
  );
}

export default function App() {
  const { configured, loading, isAuthenticated } = useAuth();

  // Oturum durumu okunana kadar bekle (yanlışlıkla login ekranı çakmasın)
  if (loading) return <FullScreenLoader />;

  // Supabase yapılandırılmışsa ve giriş yoksa: yalnızca giriş ekranı.
  // (configured=false ise lokal/mock geliştirme — duvar atlanır.)
  if (configured && !isAuthenticated) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/portfolio" replace />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        {/* Eski rota geriye dönük uyumluluk için yönlendirilir */}
        <Route path="/short-term" element={<Navigate to="/opportunities" replace />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="*" element={<Navigate to="/portfolio" replace />} />
      </Route>
    </Routes>
  );
}
