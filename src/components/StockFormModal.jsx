import { useState, useEffect, useRef } from 'react';
import { X, Search, ArrowLeftRight, ChevronDown, ChevronUp, Plus, Trash2, Loader2 } from 'lucide-react';
import { searchSymbols, fetchSymbolProfile } from '../services/liveData.js';

const MARKETS = ['BIST', 'NASDAQ', 'NYSE', 'Diğer'];
const CURRENCIES = ['TRY', 'USD', 'EUR'];

const EMPTY_FORM = {
  ticker: '',
  company: '',
  market: 'BIST',
  quantity: '',
  avgPrice: '',
  currentPrice: '',
  currency: 'TRY',
  sector: '',
  notes: '',
  dailyChangePercent: '',
  monthlyChangePercent: '',
  threeMonthChangePercent: '',
};

const PERIOD_FIELDS = [
  ['dailyChangePercent', 'Günlük %'],
  ['monthlyChangePercent', 'Aylık %'],
  ['threeMonthChangePercent', '3 Aylık %'],
];

// mode 'quantity': value = adet; mode 'amount': value = yatırılan tutar (adet = tutar / fiyat)
const EMPTY_TRANCHE = { mode: 'quantity', value: '', price: '' };

/** Tek bir kademenin adet karşılığı (geçersizse null). */
function getTrancheQuantity(tranche) {
  const value = Number(tranche.value);
  const price = Number(tranche.price);
  if (!(value > 0) || !(price > 0)) return null;
  return tranche.mode === 'amount' ? value / price : value;
}

function validate(form, entryMode, amount) {
  const errors = {};
  if (!form.ticker.trim()) errors.ticker = 'Hisse kodu zorunludur.';
  if (!form.company.trim()) errors.company = 'Şirket adı zorunludur.';

  const checkPositive = (key, raw, label) => {
    const value = Number(raw);
    if (raw === '' || Number.isNaN(value)) {
      errors[key] = `${label} sayısal bir değer olmalıdır.`;
    } else if (value <= 0) {
      errors[key] = `${label} sıfırdan büyük olmalıdır.`;
    }
  };

  if (entryMode === 'amount') {
    checkPositive('quantity', amount, 'Yatırılan tutar');
  } else {
    checkPositive('quantity', form.quantity, 'Adet');
  }
  checkPositive('avgPrice', form.avgPrice, 'Ortalama alış fiyatı');
  checkPositive('currentPrice', form.currentPrice, 'Güncel fiyat');

  for (const [field, label] of PERIOD_FIELDS) {
    if (form[field] !== '' && form[field] != null && Number.isNaN(Number(form[field]))) {
      errors[field] = `${label} sayısal olmalıdır.`;
    }
  }
  return errors;
}

function Field({ label, error, children, labelExtra = null }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
        <span>{label}</span>
        {labelExtra}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-loss">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-navy-700 bg-navy-850 px-3 py-2 text-sm text-ink placeholder-slate-600 outline-none transition-colors focus:border-accent';

/** Kademeli alım satırlarından toplam adet + ağırlıklı ortalama maliyet. */
function summarizeTranches(tranches) {
  let totalQty = 0;
  let totalCost = 0;
  for (const t of tranches) {
    const qty = getTrancheQuantity(t);
    if (qty != null) {
      totalQty += qty;
      totalCost += qty * Number(t.price);
    }
  }
  if (totalQty <= 0) return null;
  return { totalQty, totalCost, avgPrice: totalCost / totalQty };
}

export default function StockFormModal({ isOpen, stock, onSave, onClose, tourOpenAdvanced = false }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  // Adet ⇄ Tutar girişi: 'quantity' modunda adet, 'amount' modunda yatırılan para girilir
  const [entryMode, setEntryMode] = useState('quantity');
  const [amount, setAmount] = useState('');

  // Otomatik tamamlama durumu
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const skipNextSearchRef = useRef(false);

  // Gelişmiş: kademeli alım
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tranches, setTranches] = useState([{ ...EMPTY_TRANCHE }, { ...EMPTY_TRANCHE }]);

  // id'siz "stock" prop'u ön doldurma (örn. izleme listesinden taşıma) demektir
  const isEdit = Boolean(stock?.id);

  useEffect(() => {
    if (isOpen) {
      setForm(stock ? { ...EMPTY_FORM, ...stock } : EMPTY_FORM);
      setErrors({});
      setEntryMode('quantity');
      setAmount('');
      setSuggestions([]);
      setShowSuggestions(false);
      setAdvancedOpen(false);
      setTranches([{ ...EMPTY_TRANCHE }, { ...EMPTY_TRANCHE }]);
      skipNextSearchRef.current = true; // düzenleme açılışında arama tetiklenmesin
    }
  }, [isOpen, stock]);

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

  // Site eğitimi (tur) kademeli alım adımında gelişmiş bölümü otomatik açar
  useEffect(() => {
    if (isOpen && tourOpenAdvanced) setAdvancedOpen(true);
  }, [isOpen, tourOpenAdvanced]);

  if (!isOpen) return null;

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  /** Öneriden hisse seçimi: profil çekilir, form otomatik doldurulur. */
  async function handlePickSuggestion(item) {
    skipNextSearchRef.current = true;
    setShowSuggestions(false);
    setProfileLoading(true);
    setForm((f) => ({ ...f, ticker: item.ticker, company: item.name, market: item.market }));

    const profile = await fetchSymbolProfile(item.symbol);
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

  /** Tutar modunda hesaplanan adet (canlı önizleme). */
  const computedQuantity =
    entryMode === 'amount' && Number(amount) > 0 && Number(form.avgPrice) > 0
      ? Number(amount) / Number(form.avgPrice)
      : null;

  const trancheSummary = summarizeTranches(tranches);

  // Üstte hâlihazırda girili mevcut pozisyon (adet/tutar + ortalama fiyat)
  const existingQty =
    entryMode === 'amount'
      ? Number(amount) > 0 && Number(form.avgPrice) > 0
        ? Number(amount) / Number(form.avgPrice)
        : 0
      : Number(form.quantity) > 0
        ? Number(form.quantity)
        : 0;
  const existingPrice = Number(form.avgPrice) > 0 ? Number(form.avgPrice) : 0;
  const hasExisting = existingQty > 0 && existingPrice > 0;

  // Kademeler mevcut pozisyonun ÜZERİNE eklenir; ağırlıklı ortalama birleştirilir
  const combinedPurchase = trancheSummary
    ? (() => {
        const baseQty = hasExisting ? existingQty : 0;
        const baseCost = hasExisting ? existingQty * existingPrice : 0;
        const totalQty = baseQty + trancheSummary.totalQty;
        return { totalQty, avgPrice: (baseCost + trancheSummary.totalCost) / totalQty };
      })()
    : null;

  function applyTranches() {
    if (!combinedPurchase) return;
    setEntryMode('quantity');
    setForm((f) => ({
      ...f,
      quantity: String(Number(combinedPurchase.totalQty.toFixed(6))),
      avgPrice: String(Number(combinedPurchase.avgPrice.toFixed(4))),
    }));
    // Kademeler toplama dahil edildi; tekrar eklenmesin diye sıfırlanır
    setTranches([{ ...EMPTY_TRANCHE }, { ...EMPTY_TRANCHE }]);
  }

  function setTrancheField(index, field, value) {
    setTranches((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const validationErrors = validate(form, entryMode, amount);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const toOptionalNumber = (value) => (value === '' || value == null ? null : Number(value));
    const quantity =
      entryMode === 'amount'
        ? Number((Number(amount) / Number(form.avgPrice)).toFixed(6))
        : Number(form.quantity);

    onSave({
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
      company: form.company.trim(),
      sector: form.sector.trim(),
      quantity,
      avgPrice: Number(form.avgPrice),
      currentPrice: Number(form.currentPrice),
      dailyChangePercent: toOptionalNumber(form.dailyChangePercent),
      monthlyChangePercent: toOptionalNumber(form.monthlyChangePercent),
      threeMonthChangePercent: toOptionalNumber(form.threeMonthChangePercent),
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
            {isEdit ? 'Hisseyi Düzenle' : 'Yeni Hisse Ekle'}
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
              <div className="relative" data-tour="stock-search">
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
                    {suggestions.map((item) => (
                      <li key={item.symbol}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handlePickSuggestion(item);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-navy-700/60"
                        >
                          <span className="text-sm font-bold text-ink">{item.ticker}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                            {item.name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              item.market === 'BIST'
                                ? 'bg-accent/15 text-accent-soft'
                                : 'bg-cyan-400/15 text-cyan-300'
                            }`}
                          >
                            {item.market}
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

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div data-tour="amount-converter">
            <Field
              label={entryMode === 'amount' ? 'Yatırılan Tutar *' : 'Adet *'}
              error={errors.quantity}
              labelExtra={
                <button
                  type="button"
                  onClick={() => setEntryMode((m) => (m === 'quantity' ? 'amount' : 'quantity'))}
                  className="flex items-center gap-1 rounded border border-navy-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition-colors hover:border-accent/50 hover:text-accent-soft"
                  title={
                    entryMode === 'quantity'
                      ? 'Adet yerine yatırdığınız tutarı girin; adet otomatik hesaplanır'
                      : 'Tutar yerine adet girin'
                  }
                >
                  <ArrowLeftRight size={10} />
                  {entryMode === 'quantity' ? 'Tutar gir' : 'Adet gir'}
                </button>
              }
            >
              {entryMode === 'amount' ? (
                <>
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Örn: 1000 (${form.currency})`}
                  />
                  {computedQuantity != null && (
                    <p className="mt-1 text-[11px] text-gain">
                      ≈ {Number(computedQuantity.toFixed(6)).toLocaleString('tr-TR', { maximumFractionDigits: 6 })} adet
                    </p>
                  )}
                </>
              ) : (
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  step="any"
                  value={form.quantity}
                  onChange={setField('quantity')}
                  placeholder="100 (küsuratlı olabilir)"
                />
              )}
            </Field>
            </div>
            <Field label="Ort. Alış Fiyatı *" error={errors.avgPrice}>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="any"
                value={form.avgPrice}
                onChange={setField('avgPrice')}
                placeholder="245.00"
              />
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
          </div>

          {/* Gelişmiş: kademeli alım hesaplayıcı */}
          <div data-tour="tranche-calculator" className="rounded-lg border border-navy-700/60 bg-navy-850/50">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-slate-300 transition-colors hover:text-ink"
            >
              <span>Gelişmiş — Kademeli Alım Hesaplayıcı</span>
              {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {advancedOpen && (
              <div className="space-y-2 border-t border-navy-700/60 px-3 py-3">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Farklı fiyatlardan yaptığınız alımları girin (örn: 215$'dan 5 adet, 290$'dan 10
                  adet). Kademeler, üstte girili mevcut adet ve ortalama maliyetle{' '}
                  <span className="text-slate-400">birleştirilir</span> (ağırlıklı ortalama) ve forma aktarılır.
                </p>

                {tranches.map((tranche, index) => {
                  const rowQty = getTrancheQuantity(tranche);
                  return (
                    // eslint-disable-next-line react/no-array-index-key
                    <div key={index}>
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-slate-600">
                          {index + 1}.
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setTrancheField(
                              index,
                              'mode',
                              tranche.mode === 'quantity' ? 'amount' : 'quantity'
                            )
                          }
                          className="flex w-16 shrink-0 items-center justify-center gap-1 rounded-lg border border-navy-700 px-1.5 py-2 text-[10px] font-medium text-slate-400 transition-colors hover:border-accent/50 hover:text-accent-soft"
                          title={
                            tranche.mode === 'quantity'
                              ? 'Bu kademede adet yerine yatırılan tutarı girmek için tıklayın'
                              : 'Bu kademede tutar yerine adet girmek için tıklayın'
                          }
                        >
                          <ArrowLeftRight size={10} />
                          {tranche.mode === 'quantity' ? 'Adet' : 'Tutar'}
                        </button>
                        <input
                          className={`${inputClass} flex-1`}
                          type="number"
                          min="0"
                          step="any"
                          value={tranche.value}
                          onChange={(e) => setTrancheField(index, 'value', e.target.value)}
                          placeholder={
                            tranche.mode === 'amount'
                              ? `Tutar (örn: 1000 ${form.currency})`
                              : 'Adet (örn: 5)'
                          }
                        />
                        <span className="text-xs text-slate-600">×</span>
                        <input
                          className={`${inputClass} flex-1`}
                          type="number"
                          min="0"
                          step="any"
                          value={tranche.price}
                          onChange={(e) => setTrancheField(index, 'price', e.target.value)}
                          placeholder="Fiyat (örn: 215)"
                        />
                        <button
                          type="button"
                          onClick={() => setTranches((rows) => rows.filter((_, i) => i !== index))}
                          disabled={tranches.length <= 1}
                          className="shrink-0 rounded p-1.5 text-slate-500 transition-colors hover:bg-navy-700 hover:text-loss disabled:opacity-30"
                          aria-label="Kademeyi sil"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {tranche.mode === 'amount' && rowQty != null && (
                        <p className="ml-24 mt-0.5 text-[10px] text-gain">
                          ≈ {Number(rowQty.toFixed(6)).toLocaleString('tr-TR', { maximumFractionDigits: 6 })} adet
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setTranches((rows) => [...rows, { ...EMPTY_TRANCHE }])}
                    className="flex items-center gap-1 rounded-lg border border-navy-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-navy-800"
                  >
                    <Plus size={12} />
                    Kademe Ekle
                  </button>

                  {combinedPurchase && (
                    <button
                      type="button"
                      onClick={applyTranches}
                      title={
                        hasExisting
                          ? 'Mevcut pozisyon + kademeler birleştirilip toplam adet ve ağırlıklı ortalama forma yazılır'
                          : 'Toplam adet ve ağırlıklı ortalama forma yazılır'
                      }
                      className="rounded-lg bg-accent/15 px-3 py-1.5 text-[11px] font-semibold text-accent-soft transition-colors hover:bg-accent hover:text-white"
                    >
                      {hasExisting ? 'Mevcuda ekle: ' : 'Uygula: '}
                      {Number(combinedPurchase.totalQty.toFixed(6)).toLocaleString('tr-TR')} adet
                      @ {combinedPurchase.avgPrice.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ort.
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Para Birimi">
              <select className={inputClass} value={form.currency} onChange={setField('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Sektör">
              <input
                className={inputClass}
                value={form.sector}
                onChange={setField('sector')}
                placeholder="Listeden seçince otomatik dolar"
              />
            </Field>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">
              Dönemsel Değişim (%){' '}
              <span className="font-normal text-slate-600">
                — opsiyonel; günlük değişim canlı veriden otomatik dolar
              </span>
            </p>
            <div className="grid grid-cols-3 gap-4">
              {PERIOD_FIELDS.map(([field, label]) => (
                <Field key={field} label={label} error={errors[field]}>
                  <input
                    className={inputClass}
                    type="number"
                    step="any"
                    value={form[field] ?? ''}
                    onChange={setField(field)}
                    placeholder="0.0"
                  />
                </Field>
              ))}
            </div>
          </div>

          <Field label="Not">
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              value={form.notes}
              onChange={setField('notes')}
              placeholder="İsteğe bağlı not..."
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
