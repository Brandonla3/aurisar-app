import { useState, useEffect, useCallback } from 'react';
import { sb }          from '../../utils/supabase.js';
import { mergeConfig } from '../world/game/avatarSchema.js';

/**
 * Load and save a user's AvatarConfig from Supabase profiles.avatar_config.
 *
 * @param {string|null} userId  — Supabase auth user ID
 * @returns {{ config, save, loading, saving, error }}
 *
 * `loading` — true only during initial fetch
 * `saving`  — true only while a save is in-flight
 * `error`   — last save error message (null if none / cleared on next save)
 */
export function useAvatarConfig(userId) {
  const [config,  setConfig]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!userId) return;
    let canceled = false;
    setLoading(true);
    sb
      .from('profiles')
      .select('avatar_config')
      .eq('id', userId)
      .single()
      .then(({ data, error: err }) => {
        if (canceled) return;
        if (err) { setError(err.message); }
        else     { setConfig(mergeConfig(data?.avatar_config)); }
        setLoading(false);
      });
    return () => { canceled = true; };
  }, [userId]);

  const save = useCallback(async (newConfig) => {
    if (!userId) return false;
    setError(null);
    setSaving(true);
    const { error: err } = await sb
      .from('profiles')
      .update({ avatar_config: newConfig })
      .eq('id', userId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return false;
    }
    setConfig(mergeConfig(newConfig));
    return true;
  }, [userId]);

  return { config, save, loading, saving, error };
}
