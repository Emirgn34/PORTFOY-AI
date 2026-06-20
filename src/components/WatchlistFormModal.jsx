import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { searchSymbols, fetchSymbolProfile } from '../services/liveData.js';

const MARKETS = ['BIST', 'NASDAQ', 'NYSE', 'Diğer'];
const CURRENCIES = ['TRY', 'USD', 'EUR'];

export const HORIZON_OPTIONS = [
  { value: 'long', label: 'Uzun Vade' },
  { value: 'short', label: 'Kısa Vade' },
];

const EMPTY_FORM = {
  ticker: '',
  company: '',
  market: 'BIST',
  sector: '',
  currency: 'TRY',
  currentPrice: '',
  dailyChangePercent: '',
  targetPrice: '',
  horizon: 'long',
  notes: '',
};

function validate(form) {
  const errors = {};
  if (!form.ticker.trim()) errors.ticker = 'Hisse kodu zorunludur.';
  if (!form.company.trim()) errors.company = 'Şirket adı zorunludur.';

  const price = Number(form.currentPrice);
  if (form.currentPrice === '' || Number.isNaN(price)) {
    errors.currentPrice = 'Güncel fiyat sayısal olmalıdır.';
  } else if (price <= 0) {
    errors.currentPrice = 'Güncel fiyat sıfırdan büyük olmalıdır.';
  }

  if (form.dailyChangePercent !== '' && Number.isNaN(Number(form.dailyChangePercent))) {
    errors.dailyChangePercent = 'Günlük değişim sayısal olmalıdır.';
  }

  if (form.targetPrice !== '') {
    const target = Number(form.targetPrice);
    if (Number.isNaN(target)) errors.targetPrice = 'Hedef fiyat sayısal olmalıdır.';
    else if (target <= 0) errors.targetPrice = 'Hedef fiyat sıfırdan büyük olmalıdır.';
  }

  return errors;
}

function Field({ label, error, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-sm text-ink placeholder-slate-600 outline-none transition-colors focus:border-accent';

export default function WatchlistFormModal({ isOpen, item, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  // Otomatik tamamlama durumu (portföy formuyla aynı: ara → seç → profil otomatik dolar)
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const skipNextSearchRef = useRef(false);

  const isEdit = Boolean(item);

  useEffect(() => {
    if (isOpen) {
      setForm(item ? { ...EMPTY_FORM, ...item } : EMPTY_FORM);
      setErrors({});
      setSuggestions([]);
      setShowSuggestions(false);
      skipNextSearchRef.current = true; // düzenleme/açılışta arama tetiklenmesin
    }
  }, [isOpen, item]);

  // Hisse kodu yazdıkça canlı arama (300ms debounce)
  useEffect(() => {
    if (!isOpen) return undefined;
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return undefined;
    }
    const query = form.ticker.trim();
    if (query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const results = await searchSymbols(query);
      setSearchLoading(false);
      if (results) {
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticker, isOpen]);

  if (!isOpen) return null;

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  /** Öneriden hisse seçimi: profil çekilir, form otomatik doldurulur. */
  async function handlePickSuggestion(selected) {
    skipNextSearchRef.current = true;
    setShowSuggestions(false);
    setProfileLoading(true);
    setForm((f) => ({ ...f, ticker: selected.ticker, company: selected.name, market: selected.market }));

    const profile = await fetchSymbolProfile(selected.symbol);
    setProfileLoading(false);
    if (!profile) return;

    skipNextSearchRef.current = true;
    setForm((f) => ({
      ...f,
      ticker: profile.ticker,
      company: profile.company,
      market: MARKETS.includes(profile.market) ? profile.market : 'Diğer',
      currency: CURRENCIES.includes(profile.currency) ? profile.currency : f.currency,
      currentPrice: profile.currentPrice ?? f.currentPrice,
      dailyChangePercent: profile.dailyChangePercent ?? f.dailyChangePercent,
      sector: profile.sector || f.sector,
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const currentPrice = Number(form.currentPrice);

    onSave({
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
      company: form.company.trim(),
      sector: form.sector.trim(),
      currentPrice,
      dailyChangePercent: form.dailyChangePercent === '' ? 0 : Number(form.dailyChangePercent),
      targetPrice: form.targetPrice === '' ? null : Number(form.targetPrice),
      // Yeni kayıtta "eklendiğinden beri değişim" için baz fiyat ve tarih sabitlenir
      priceWhenAdded: isEdit ? item.priceWhenAdded : currentPrice,
      addedAt: isEdit ? item.addedAt : new Date().toISOString().slice(0, 10),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-navy-700 bg-navy-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-navy-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? 'İzlenen Hisseyi Düzenle' : 'İzleme Listesine Ekle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-ink"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hisse Kodu *" error={errors.ticker}>
              <div className="relative">
                <input
                  className={inputClass}
                  value={form.ticker}
                  onChange={setField('ticker')}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="MP yazın, listeden seçin..."
                  autoComplete="off"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  {searchLoading || profileLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                </span>

                {/* Otomatik tamamlama listesi */}
                {showSuggestions && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-navy-600 bg-navy-850 shadow-2xl">
                    {suggestions.map((sugg) => (
                      <li key={sugg.symbol}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handlePickSuggestion(sugg);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-navy-700/60"
                        >
                          <span className="text-sm font-bold text-ink">{sugg.ticker}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                            {sugg.name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              sugg.market === 'BIST'
                                ? 'bg-accent/15 text-accent-soft'
                                : 'bg-navy-800 text-slate-400'
                            }`}
                          >
                            {sugg.market}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Field>
            <Field label="Borsa / Piyasa">
              <select className={inputClass} value={form.market} onChange={setField('market')}>
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Şirket Adı *" error={errors.company}>
            <input
              className={inputClass}
              value={form.company}
              onChange={setField('company')}
              placeholder="Listeden seçince otomatik dolar"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Sektör">
              <input
                className={inputClass}
                value={form.sector}
                onChange={setField('sector')}
                placeholder="Listeden seçince otomatik dolar"
              />
            </Field>
            <Field label="Vade Etiketi">
              <select className={inputClass} value={form.horizon} onChange={setField('horizon')}>
                {HORIZON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Para Birimi">
              <select className={inputClass} value={form.currency} onChange={setField('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Güncel Fiyat *" error={errors.currentPrice}>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="any"
                value={form.currentPrice}
                onChange={setField('currentPrice')}
                placeholder="Otomatik dolar"
              />
            </Field>
            <Field label="Günlük %" error={errors.dailyChangePercent}>
              <input
                className={inputClass}
                type="number"
                step="any"
                value={form.dailyChangePercent}
                onChange={setField('dailyChangePercent')}
                placeholder="0.0"
              />
            </Field>
            <Field label="Hedef Fiyat" error={errors.targetPrice}>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="any"
                value={form.targetPrice ?? ''}
                onChange={setField('targetPrice')}
                placeholder="195.00"
              />
            </Field>
          </div>

          <Field label="İzleme Notu">
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              value={form.notes}
              onChange={setField('notes')}
              placeholder="Neden izliyorsunuz? Örn: 48 TL altı alım bölgesi..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-navy-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-navy-800"
            >
              İptal
            </button>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
            >
              {isEdit ? 'Güncelle' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
