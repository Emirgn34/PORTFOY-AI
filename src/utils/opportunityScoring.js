/**
 * Fırsat skor motoru — tarayıcı giriş noktası.
 * Saf skorlama mantığı opportunityScoringCore.js'tedir (React/lucide bağımsız,
 * Node toplayıcısı da kullanır). Burada yalnızca lucide ikonuna ihtiyaç duyan
 * UI yardımcısı (getSentimentIcon) tutulur; gerisi çekirdekten re-export edilir.
 */
import { TrendingUp, TrendingDown, MoveRight } from 'lucide-react';

export * from './opportunityScoringCore.js';

/** Sentiment için ikon + renk konfigürasyonu döndürür. */
export function getSentimentIcon(sentiment) {
  if (sentiment === 'positive') {
    return { Icon: TrendingUp, label: 'Pozitif', text: 'text-gain', bg: 'bg-gain/15' };
  }
  if (sentiment === 'negative') {
    return { Icon: TrendingDown, label: 'Negatif', text: 'text-loss', bg: 'bg-loss/15' };
  }
  return { Icon: MoveRight, label: 'Nötr', text: 'text-slate-400', bg: 'bg-navy-800' };
}
