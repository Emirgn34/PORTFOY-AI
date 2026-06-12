import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import WatchlistPage from './pages/WatchlistPage.jsx';
import NewsPage from './pages/NewsPage.jsx';
import OpportunitiesPage from './pages/OpportunitiesPage.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';

export default function App() {
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
