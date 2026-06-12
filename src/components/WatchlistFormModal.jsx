import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

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
  'w-full rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-accent';

export default function WatchlistFormModal({ isOpen, item, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  const isEdit = Boolean(item);

  useEffect(() => {
    if (isOpen) {
      setForm(item ? { ...EMPTY_FORM, ...item } : EMPTY_FORM);
      setErrors({});
    }
  }, [isOpen, item]);

  if (!isOpen) return null;

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

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
          <h2 className="text-base font-semibold text-white">
            {isEdit ? 'İzlenen Hisseyi Düzenle' : 'İzleme Listesine Ekle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-navy-800 hover:text-white"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Hisse Kodu *" error={errors.ticker}>
              <input
                className={inputClass}
                value={form.ticker}
                onChange={setField('ticker')}
                placeholder="Örn: TUPRS"
              />
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
              placeholder="Örn: Tüpraş"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Sektör">
              <input
                className={inputClass}
                value={form.sector}
                onChange={setField('sector')}
                placeholder="Örn: Enerji"
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
                placeholder="182.50"
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
