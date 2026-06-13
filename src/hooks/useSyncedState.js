import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient.js';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * Kullanıcıya bağlı, çok cihaz senkron durum hook'u.
 *
 * Giriş yapılmışsa veriyi Supabase'deki <table>.<column> (jsonb) satırından
 * okur/yazar — satır user_id'ye bağlıdır ve RLS ile yalnızca sahibi erişir.
 * Böylece kullanıcı hangi cihazdan girerse girsin aynı veriyi görür.
 * Giriş yoksa veya Supabase yapılandırılmamışsa localStorage'a düşer
 * (lokal/mock geliştirme bozulmaz).
 *
 * API, useLocalStorage ile uyumludur: [value, setValue] döner; setValue hem
 * doğrudan değeri hem de fonksiyonel updater'ı (prev => next) destekler.
 * Üçüncü eleman { loading, cloud } durum bilgisidir.
 *
 * NOT: Çağıran taraf, veri kullanıcının gerçek satırından gelene kadar (loading)
 * fiyat çekme gibi yan etkileri başlatmamalı — bu yüzden içerik bileşeni
 * yalnızca loading=false olunca mount edilmelidir.
 */
export default function useSyncedState({ table, column, localKey, seed }) {
  const { configured, isAuthenticated, user } = useAuth();
  const cloud = Boolean(configured && isAuthenticated && supabase && user);

  const [value, setValueState] = useState(seed);
  const [loading, setLoading] = useState(true);
  const valueRef = useRef(seed);
  const userIdRef = useRef(null);
  const readyRef = useRef(false); // yükleme bitmeden cloud'a yazma yapılmaz
  const saveTimer = useRef(null);

  const apply = (v) => {
    valueRef.current = v;
    setValueState(v);
  };

  // Yükleme: cloud'dan veya localStorage'dan
  useEffect(() => {
    let active = true;
    readyRef.current = false;
    setLoading(true);

    (async () => {
      if (cloud) {
        userIdRef.current = user.id;
        const { data } = await supabase
          .from(table)
          .select(column)
          .eq('user_id', user.id)
          .maybeSingle();
        if (!active) return;
        if (data && data[column] != null) {
          apply(data[column]);
        } else {
          // İlk giriş: kullanıcının cloud satırını seed ile oluştur
          apply(seed);
          await supabase
            .from(table)
            .upsert({ user_id: user.id, [column]: seed, updated_at: new Date().toISOString() });
        }
      } else {
        userIdRef.current = null;
        let initial = seed;
        try {
          const stored = window.localStorage.getItem(localKey);
          if (stored !== null) initial = JSON.parse(stored);
        } catch {
          /* erişilemezse seed kullan */
        }
        if (!active) return;
        apply(initial);
      }
      if (!active) return;
      readyRef.current = true;
      setLoading(false);
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, user?.id]);

  // Kalıcılaştır: cloud → debounce'lu upsert; local → anında localStorage
  const persist = useCallback(
    (data) => {
      if (!readyRef.current) return; // yükleme sırasındaki ara güncellemeleri yazma
      if (cloud && userIdRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          supabase
            .from(table)
            .upsert({ user_id: userIdRef.current, [column]: data, updated_at: new Date().toISOString() })
            .then(null, () => {});
        }, 700);
      } else {
        try {
          window.localStorage.setItem(localKey, JSON.stringify(data));
        } catch {
          /* localStorage dolu/erişilemez — sessizce geç */
        }
      }
    },
    [cloud, table, column, localKey]
  );

  const setValue = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(valueRef.current) : next;
      apply(resolved);
      persist(resolved);
    },
    [persist]
  );

  return [value, setValue, { loading, cloud }];
}
