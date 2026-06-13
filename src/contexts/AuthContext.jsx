/**
 * Kimlik durumu sağlayıcısı.
 *
 * Oturumu ve giriş yapan kullanıcının profilini (kullanıcı adı + rol) izler.
 * Supabase oturum değişikliklerini (giriş/çıkış/token yenileme) dinler ve
 * durumu günceller. useAuth() hook'u ile her bileşenden erişilir.
 *
 * Supabase yapılandırılmamışsa (env yok) auth devre dışı kalır: configured=false
 * döner; App bu durumda giriş duvarını atlar (lokal/mock geliştirme).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, HAS_SUPABASE } from '../services/supabaseClient.js';
import { getProfile } from '../services/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(HAS_SUPABASE);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!HAS_SUPABASE) {
      setLoading(false);
      return;
    }

    let active = true;

    // İlk yüklemede mevcut oturumu al
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const s = data.session ?? null;
      setSession(s);
      setProfile(s ? await getProfile(s.user.id) : null);
      setLoading(false);
    });

    // Sonraki oturum değişikliklerini dinle
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!active) return;
      setSession(s ?? null);
      setProfile(s ? await getProfile(s.user.id) : null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = {
    configured: HAS_SUPABASE,
    loading,
    session,
    user: session?.user ?? null,
    profile,
    username: profile?.username ?? null,
    role: profile?.role ?? null,
    isAdmin: profile?.role === 'admin',
    isAuthenticated: Boolean(session),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
