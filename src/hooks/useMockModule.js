import { useEffect, useState } from 'react';
import { MOCK_ENABLED } from '../config.js';

/**
 * Mock (demo) modüllerini yalnızca MOCK_ENABLED iken ve İHTİYAÇ ANINDA yükler.
 *
 * Mock dosyaları sayfalardan statik import EDİLMEZ: ~30 kB demo verisi,
 * bayrak kapalıyken bile sayfa paketiyle birlikte iniyordu (madde 10).
 * Dinamik import ile mock ayrı bir chunk olur ve production'da hiç indirilmez.
 *
 * `load` MODÜL DÜZEYİNDE sabit bir `() => import('...')` olmalıdır; bileşen
 * içinde tanımlanırsa her render'da effect yeniden koşar.
 * Bayrak kapalıyken her zaman null döner — çağıran `?? []` / `?? null` ile
 * production yolunu seçer.
 */
export default function useMockModule(load) {
  const [mod, setMod] = useState(null);
  useEffect(() => {
    if (!MOCK_ENABLED) return undefined;
    let active = true;
    load().then((m) => {
      if (active) setMod(m);
    });
    return () => {
      active = false;
    };
  }, [load]);
  return MOCK_ENABLED ? mod : null;
}
