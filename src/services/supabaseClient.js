/**
 * Tekil (singleton) Supabase istemcisi — kimlik doğrulama + veri okuma.
 *
 * Oturum tarayıcının localStorage'ında saklanır ve token otomatik yenilenir
 * (@supabase/supabase-js bunu kendisi yönetir). Env değişkenleri Vercel'de
 * tanımlıdır: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
 *
 * Env yoksa (örn. tamamen lokal/mock çalışma) null döner; auth katmanı bunu
 * algılayıp giriş duvarını devre dışı bırakır, uygulama mock'la açılır.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = HAS_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export { SUPABASE_URL, SUPABASE_ANON_KEY };
