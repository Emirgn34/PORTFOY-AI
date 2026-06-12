/**
 * Skor ve sentiment renk yardımcıları.
 * Tüm sayfalarda tutarlı renk dili için tek kaynak.
 */

/** 0-100 skor için renk sınıfları: 0-39 kırmızı, 40-69 sarı/turuncu, 70-100 yeşil. */
export function getScoreColors(score) {
  if (score >= 70) {
    return {
      text: 'text-gain',
      bg: 'bg-gain',
      badge: 'bg-gain/15 text-gain border-gain/30',
      stroke: '#22c55e',
    };
  }
  if (score >= 40) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-400',
      badge: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
      stroke: '#fbbf24',
    };
  }
  return {
    text: 'text-loss',
    bg: 'bg-loss',
    badge: 'bg-loss/15 text-loss border-loss/30',
    stroke: '#ef4444',
  };
}

/** 1-10 güvenilirlik puanı için renkler: 1-3 kırmızı, 4-6 turuncu/sarı, 7-10 yeşil. */
export function getReliabilityColors(score) {
  if (score >= 7) {
    return { text: 'text-gain', badge: 'bg-gain/15 text-gain border-gain/30', bg: 'bg-gain' };
  }
  if (score >= 4) {
    return {
      text: 'text-amber-400',
      badge: 'bg-amber-400/15 text-amber-400 border-amber-400/30',
      bg: 'bg-amber-400',
    };
  }
  return { text: 'text-loss', badge: 'bg-loss/15 text-loss border-loss/30', bg: 'bg-loss' };
}

/** Sentiment etiketi ve renkleri. */
export const SENTIMENT_CONFIG = {
  positive: { label: 'Pozitif', text: 'text-gain', badge: 'bg-gain/15 text-gain border-gain/30' },
  negative: { label: 'Negatif', text: 'text-loss', badge: 'bg-loss/15 text-loss border-loss/30' },
  neutral: {
    label: 'Nötr',
    text: 'text-amber-300/80',
    badge: 'bg-slate-400/15 text-slate-300 border-slate-400/30',
  },
};

/** Öneri etiketi renkleri (Portföy Yorumu sayfası). */
export const RECOMMENDATION_CONFIG = {
  'Güçlü': 'bg-gain/15 text-gain border-gain/30',
  'İzlenmeli': 'bg-accent/15 text-accent-soft border-accent/30',
  'Riskli': 'bg-loss/15 text-loss border-loss/30',
  'Nötr': 'bg-slate-400/15 text-slate-300 border-slate-400/30',
};

/** Risk seviyesi renkleri. */
export const RISK_LEVEL_CONFIG = {
  'Düşük': 'bg-gain/15 text-gain border-gain/30',
  'Orta': 'bg-amber-400/15 text-amber-400 border-amber-400/30',
  'Yüksek': 'bg-loss/15 text-loss border-loss/30',
};
