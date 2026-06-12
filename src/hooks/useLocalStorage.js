import { useState, useEffect } from 'react';

/**
 * localStorage ile senkronize çalışan basit state hook'u.
 * İleride backend'e geçildiğinde bu hook'un yerine API tabanlı
 * bir veri katmanı (ör. React Query) takılabilir.
 */
export default function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage dolu veya erişilemez ise sessizce geç
    }
  }, [key, value]);

  return [value, setValue];
}
