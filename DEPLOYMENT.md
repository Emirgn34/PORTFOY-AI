# PortföyAI devreye alma ve kurulum kontrol listesi

## Güvenli geri dönüş

Değişiklik öncesi proje `backup/pre-improvements-20260809` Git dalında korunur.
Eski sürümü incelemek veya tekrar çalıştırmak için backup dalına geçmek
yeterlidir; dalı silmeyin.

## 1. Supabase migration'ları

Supabase SQL Editor'da sırasıyla çalıştırın. Her dosya bir kez çalıştırılır;
tekrar çalıştırmak zararsızdır (hepsi `if not exists` / `create or replace`).

| Dosya | Ne kurar | Çalıştırılmazsa ne olur |
|---|---|---|
| `supabase/schema.sql` | tracked_symbols / quotes / fx_rates / news | Canlı veri hiç birikmez |
| `supabase/auth-schema.sql` | profiles + RLS + giriş duvarı | Giriş sistemi çalışmaz |
| `supabase/portfolio-schema.sql` | portfolios (hesaba bağlı portföy) | Portföy cihazlar arası senkron olmaz |
| `supabase/watchlist-schema.sql` | watchlists | Takip listesi senkron olmaz |
| `supabase/analysis-schema.sql` | portfolio_analyses | Portföy Analizi kaydedilemez |
| `supabase/ai-control-schema.sql` | Claude cache + maliyet sayacı + kullanıcı kotası | **Analiz çalışır ama AI yorumu ÜRETİLMEZ** |
| `supabase/backtest-schema.sql` | Backtest epizotları | Backtest raporu boş kalır |

`ai-control-schema.sql` çalıştırılmadığında uygulama çökmez; deterministik
fallback ile çalışır. Artık bu durum **arayüzde de görünür**: Portföy Analizi
sayfasında "AI kota tablosu kurulu değil…" notu çıkar.

## 2. Ortam değişkenleri

`.env.example` referanstır. Nereye ne konacağı:

**Vercel → Settings → Environment Variables (Production)**

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
AI_DAILY_BUDGET_USD=1.00
PORTFOLIO_AI_DAILY_LIMIT=5
PORTFOLIO_AI_CACHE_HOURS=6
PORTFOLIO_AI_COOLDOWN_SECONDS=300
VITE_ENABLE_MOCK_DATA=false
VITE_CONVICTION_THRESHOLD=78
```

**GitHub → Settings → Secrets and variables → Actions**

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
CONVICTION_THRESHOLD=78
```

`VITE_` önekli değişkenler tarayıcıya gömülür — service_role anahtarını ASLA
`VITE_` ile tanımlamayın. Maliyet değişkenleri tanımsızsa kod güvenli
varsayılanlara düşer (bütçe $1/gün, kullanıcı başına 5 analiz/gün).

### Bir değişkenin gerçekten geçtiğini doğrulama

`VITE_` değişkenleri **build sırasında** gömülür; Vercel'de ekledikten sonra
yeniden deploy şarttır. Doğrulamak için canlı sitenin bundle'ında değeri arayın
(ör. `VITE_SUPABASE_URL` için proje kimliğinin bundle içinde geçmesi gerekir).

## 3. Kanıt kapısı kalibrasyonu

`CONVICTION_THRESHOLD` (varsayılan 78) artık **ortam değişkeni** — ayarlamak için
kod değişikliği/deploy gerekmez, Vercel + GitHub'da değeri değiştirip yeniden
çalıştırmak yeterlidir.

Kalibrasyon canlı veri ister; sentetik senaryolarla yapılan ilk ayar henüz
gerçek turla doğrulanmadı. Sıra:

1. GitHub → Actions → **Backtest Raporu** → Run workflow.
2. Rapordaki 20/252 işlem günü sonuçlarına bakın.
3. Fırsatlar sürekli boşsa eşiği düşürün, çok doluysa yükseltin.
4. Her değişiklikten sonra bir sonraki raporu bekleyin — tek turda karar vermeyin.

## 4. Doğrulama

```bash
npm test
```

`npm test` iki katmanı birden koşar:

- `npm run test:unit` — sunucu, skor motoru, maliyet hesabı (`node --test`)
- `npm run test:ui` — React bileşenleri, **production kod yolunda** (`vitest`)

Arayüz testleri `MOCK_ENABLED=false` ile koşar; demo veri fallback'i kapalıyken
ortaya çıkan (ve dev'de asla görünmeyen) hatalar bu sayede yakalanır.

```bash
npm run build
```
