import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout.jsx';
import { useAuth } from './contexts/AuthContext.jsx';

const PortfolioPage = lazy(() => import('./pages/PortfolioPage.jsx'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage.jsx'));
const NewsPage = lazy(() => import('./pages/NewsPage.jsx'));
const OpportunitiesPage = lazy(() => import('./pages/OpportunitiesPage.jsx'));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));

/** Oturum çözümlenirken gösterilen tam ekran yükleme durumu. */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950">
      <Loader2 size={28} className="animate-spin text-accent-soft" />
    </div>
  );
}

export default function App() {
  const { configured, loading, isAuthenticated, isAdmin } = useAuth();

  // Oturum durumu okunana kadar bekle (yanlışlıkla login ekranı çakmasın)
  if (loading) return <FullScreenLoader />;

  // Supabase yapılandırılmışsa ve giriş yoksa: yalnızca giriş ekranı.
  // (configured=false ise lokal/mock geliştirme — duvar atlanır.)
  if (configured && !isAuthenticated) {
    return (
      <Suspense fallback={<FullScreenLoader />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullScreenLoader />}>
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
        {/* Hesabım — her giriş yapan kullanıcı kendi ayarlarına erişir */}
        <Route path="/account" element={<AccountPage />} />
        {/* Admin paneli yalnızca yöneticiye; değilse portföye yönlendirilir */}
        <Route
          path="/admin"
          element={isAdmin ? <AdminPage /> : <Navigate to="/portfolio" replace />}
        />
        <Route path="*" element={<Navigate to="/portfolio" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
