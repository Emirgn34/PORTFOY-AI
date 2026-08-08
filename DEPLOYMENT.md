# PortföyAI iyileştirmelerini devreye alma

## Güvenli geri dönüş

Değişiklik öncesi proje `backup/pre-improvements-20260809` Git dalında korunur.
Geliştirmeler `codex/cost-profit-improvements` dalındadır. Eski sürümü incelemek
veya tekrar çalıştırmak için backup dalına geçmek yeterlidir; dalı silmeyin.

## Supabase migration

Supabase SQL Editor'da sırasıyla çalıştırın:

1. `supabase/ai-control-schema.sql`
2. Güncellenmiş `supabase/backtest-schema.sql`

İlk dosya kalıcı Claude cache'i, token/maliyet özeti ve kullanıcı kotasını kurar.
İkinci dosya aynı günlük sinyalleri tek epizot yapar ve AI/kural karşılaştırma
alanlarını ekler. Migration uygulanmadan uygulama deterministik fallback ile
çalışır; ancak kalıcı cache ve portföy AI kotası etkin olmaz.

## Ortam değişkenleri

`.env.example` içindeki sunucu değişkenlerini GitHub Actions ve Vercel'e ekleyin.
Önerilen başlangıç değerleri:

```text
AI_DAILY_BUDGET_USD=1.00
AI_CACHE_TTL_DAYS=14
PORTFOLIO_AI_DAILY_LIMIT=5
PORTFOLIO_AI_CACHE_HOURS=6
PORTFOLIO_AI_COOLDOWN_SECONDS=300
VITE_ENABLE_MOCK_DATA=false
```

Altı saatlik aday workflow'u Batch API'yi kendisi etkinleştirir. Kullanıcı
isteklerinde standart Messages API kullanılmaya devam eder.

## Doğrulama

```text
npm test
npm run build
```

Haftalık `Backtest Raporu` iş akışı 20/252 işlem günü sonuçlarını, aynı günlük
sinyallleri tekilleştirerek ve tahmini işlem maliyetlerini düşerek raporlar.
