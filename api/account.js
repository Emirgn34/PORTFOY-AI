/**
 * Giriş yapan kullanıcının kendi kullanıcı adını değiştirdiği Vercel fonksiyonu.
 *
 * Supabase Auth teknik olarak e-posta ile giriş yaptığı için görünen profil adıyla
 * birlikte dahili `<kullanici>@portfoy.local` adresi de güncellenir. Service role
 * yalnızca sunucuda tutulur; kullanıcı başka bir hesabı hedefleyemez, kimlik JWT'den
 * alınır.
 */
import { createClient } from '@supabase/supabase-js';
import { validateUsername } from '../server/accountSettings.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_DOMAIN = 'portfoy.local';

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function isDuplicate(error) {
  const text = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || text.includes('duplicate') || text.includes('already');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Yöntem desteklenmiyor.' });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Sunucu kimlik yapılandırması eksik.' });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Oturum gerekli.' });

  const sb = adminClient();
  const { data: authData, error: authError } = await sb.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: 'Geçersiz oturum.' });

  const validation = validateUsername(req.body?.username);
  if (validation.error) return res.status(400).json({ error: validation.error });

  try {
    const { data: current, error: profileError } = await sb
      .from('profiles')
      .select('username')
      .eq('id', authData.user.id)
      .single();
    if (profileError || !current) return res.status(404).json({ error: 'Kullanıcı profili bulunamadı.' });
    if (current.username === validation.username) {
      return res.status(200).json({ ok: true, username: validation.username });
    }

    const { data: existing } = await sb
      .from('profiles')
      .select('id')
      .eq('username', validation.username)
      .neq('id', authData.user.id)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });

    const { error: updateProfileError } = await sb
      .from('profiles')
      .update({ username: validation.username })
      .eq('id', authData.user.id);
    if (updateProfileError) {
      if (isDuplicate(updateProfileError)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
      }
      throw updateProfileError;
    }

    const { error: updateAuthError } = await sb.auth.admin.updateUserById(authData.user.id, {
      email: `${validation.username}@${EMAIL_DOMAIN}`,
      email_confirm: true,
      user_metadata: { ...(authData.user.user_metadata ?? {}), username: validation.username },
    });
    if (updateAuthError) {
      // İki kaydı tutarlı tutmak için profil adını geri al.
      await sb.from('profiles').update({ username: current.username }).eq('id', authData.user.id);
      if (isDuplicate(updateAuthError)) {
        return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
      }
      throw updateAuthError;
    }

    return res.status(200).json({ ok: true, username: validation.username });
  } catch (err) {
    console.error('[account]', err.message);
    return res.status(500).json({ error: 'Kullanıcı adı güncellenemedi.' });
  }
}
