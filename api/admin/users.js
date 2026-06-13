/**
 * Admin kullanıcı yönetimi (Vercel sunucu fonksiyonu).
 *
 * Yalnızca rolü 'admin' olan kullanıcı erişebilir. Çağıran, kendi erişim
 * token'ını Authorization: Bearer ile gönderir; fonksiyon service_role ile
 * token'ı doğrular ve profiles tablosundan rolünü kontrol eder.
 *
 *   GET    → tüm kullanıcıları listeler
 *   POST   → { username, password, role } ile yeni kullanıcı oluşturur
 *   DELETE → ?id=<uuid> kullanıcıyı siler
 *
 * service_role anahtarı ASLA tarayıcıya gitmez; yalnızca burada (sunucuda)
 * kullanılır. Gerekli Vercel env değişkenleri:
 *   SUPABASE_URL (veya VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// auth.js'teki AUTH_EMAIL_DOMAIN ile aynı olmalı (kullanıcı adı → e-posta)
const EMAIL_DOMAIN = 'portfoy.local';
const usernameToEmail = (u) => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Bearer token'dan çağıranı doğrular; admin değilse hata döndürür. */
async function requireAdmin(req, sb) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: 'Token yok', status: 401 };

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return { error: 'Geçersiz oturum', status: 401 };

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();
  if (profile?.role !== 'admin') return { error: 'Yetkisiz', status: 403 };

  return { user: data.user };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Sunucu yapılandırması eksik (SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const sb = admin();
  const gate = await requireAdmin(req, sb);
  if (gate.error) return res.status(gate.status).json({ error: gate.error });

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('profiles')
        .select('id, username, role, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ users: data });
    }

    if (req.method === 'POST') {
      const { username, password, role } = req.body ?? {};
      const uname = String(username ?? '').trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,32}$/.test(uname)) {
        return res.status(400).json({ error: 'Kullanıcı adı 3-32 karakter olmalı (harf, rakam, . _ -).' });
      }
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: 'Parola en az 6 karakter olmalı.' });
      }
      const newRole = role === 'admin' ? 'admin' : 'user';

      // Kullanıcı adı zaten var mı? (dostça hata için önden kontrol)
      const { data: existing } = await sb.from('profiles').select('id').eq('username', uname).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });

      // Kullanıcıyı oluştur — trigger profiles satırını metadata'dan açar (rol dahil)
      const { data, error } = await sb.auth.admin.createUser({
        email: usernameToEmail(uname),
        password: String(password),
        email_confirm: true,
        user_metadata: { username: uname, role: newRole },
      });
      if (error) throw error;
      return res.status(201).json({ user: { id: data.user.id, username: uname, role: newRole } });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '');
      if (!id) return res.status(400).json({ error: 'id parametresi gerekli.' });
      if (id === gate.user.id) return res.status(400).json({ error: 'Kendi hesabını silemezsin.' });
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  } catch (err) {
    console.error('[admin/users]', err.message);
    return res.status(500).json({ error: err.message || 'Sunucu hatası.' });
  }
}
