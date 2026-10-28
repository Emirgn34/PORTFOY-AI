import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabaseClient.js';
import { useAuth } from '../contexts/AuthContext.jsx';

// A remounted page waits for its previous save before reading the same account.
const writesByScope = new Map();

/** User-scoped JSON state. flush() saves a completed edit without the debounce. */
export default function useSyncedState({ table, column, localKey, seed, cloudSeed = [], readOnly = false }) {
  const { configured, isAuthenticated, user } = useAuth();
  const cloud = Boolean(configured && isAuthenticated && supabase && user);
  const owner = cloud ? user.id : null;
  const scope = JSON.stringify([owner, table, column, localKey]);
  const [value, setValueState] = useState(seed);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const valueRef = useRef(seed);
  const readyRef = useRef(false);
  const scopeRef = useRef(null);
  const generationRef = useRef(0);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const chainRef = useRef(Promise.resolve());
  const ticketRef = useRef(0);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (!pending) return chainRef.current;
    pendingRef.current = null;
    // Serialize writes: a slower earlier save cannot overwrite the final order.
    const previous = writesByScope.get(pending.scope) ?? Promise.resolve();
    const task = previous.then(async () => {
      try {
        const { error } = await supabase.from(pending.table).upsert({
          user_id: pending.owner,
          [pending.column]: pending.data,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        if (generationRef.current === pending.generation && ticketRef.current === pending.ticket) {
          setSaveStatus('saved');
          setSaveError(null);
        }
        return true;
      } catch (error) {
        if (generationRef.current === pending.generation && ticketRef.current === pending.ticket) {
          setSaveStatus('error');
          setSaveError(error);
        }
        return false;
      }
    });
    writesByScope.set(pending.scope, task);
    void task.then(() => {
      if (writesByScope.get(pending.scope) === task) writesByScope.delete(pending.scope);
    });
    chainRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    let active = true;
    ++generationRef.current;
    scopeRef.current = scope;
    readyRef.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveStatus('idle');
    setSaveError(null);
    // Do not show another account's holdings during a change of session.
    if (cloud) {
      valueRef.current = cloudSeed;
      setValueState(cloudSeed);
    }
    (async () => {
      try {
        let initial = seed;
        if (cloud) {
          await writesByScope.get(scope);
          if (!active) return;
          const { data, error } = await supabase.from(table).select(column).eq('user_id', owner).maybeSingle();
          if (error) throw error;
          initial = data?.[column] ?? cloudSeed;
        } else {
          try {
            const stored = window.localStorage.getItem(localKey);
            if (stored !== null) initial = JSON.parse(stored);
          } catch { /* A blocked local store still allows the local seed to load. */ }
        }
        if (!active) return;
        valueRef.current = initial;
        setValueState(initial);
        readyRef.current = true;
      } catch (error) {
        // A failed read is never treated as an empty portfolio to write back.
        if (active) setLoadError(error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      readyRef.current = false;
      ++generationRef.current;
      // The queued edit keeps its original account ID even after navigation.
      void flush();
    };
    // Seeds are defaults, not triggers to reload a user's persisted data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, cloud, reloadToken, flush]);

  const persist = useCallback((data) => {
    const ticket = ++ticketRef.current;
    setSaveError(null);
    if (cloud) {
      setSaveStatus('saving');
      pendingRef.current = { data, owner, table, column, scope, ticket, generation: generationRef.current };
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void flush(); }, 700);
    } else {
      try {
        window.localStorage.setItem(localKey, JSON.stringify(data));
        setSaveStatus('saved');
      } catch (error) {
        setSaveStatus('error');
        setSaveError(error);
      }
    }
  }, [cloud, owner, table, column, localKey, scope, flush]);

  const setValue = useCallback((next) => {
    if (!readyRef.current || scopeRef.current !== scope || readOnly) return;
    const resolved = typeof next === 'function' ? next(valueRef.current) : next;
    if (Object.is(resolved, valueRef.current)) return;
    valueRef.current = resolved;
    setValueState(resolved);
    persist(resolved);
  }, [scope, readOnly, persist]);

  const retrySave = useCallback(() => {
    if (!readyRef.current || scopeRef.current !== scope || readOnly) return;
    persist(valueRef.current);
    return flush();
  }, [scope, readOnly, persist, flush]);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  return [value, setValue, { loading: loading || scopeRef.current !== scope, cloud, loadError, reload, saveStatus, saveError, retrySave, flush }];
}
