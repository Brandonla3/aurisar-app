import { useState, useEffect, useCallback } from 'react';
import { sb }          from '../../utils/supabase.js';
import { mergeConfig } from '../world/game/avatarSchema.js';

/**
 * Load and save a user's AvatarConfig from Supabase profiles.avatar_config.
 *
 * @param {string|null} userId  — Supabase auth user ID
 * @returns {{ config, save, loading, error }}
 */
export function useAvatarConfig(userId) {
  const [config,  setConfig]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    sb
      .from('profiles')
      .select('avatar_config')
      .eq('id', userId)
      .single()
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); }
        else     { setConfig(mergeConfig(data?.avatar_config)); }
        setLoading(false);
      });
  }, [userId]);

  const save = useCallback(async (newConfig) => {
    if (!userId) return;
    setLoading(true);
    const { error: err } = await sb
      .from('profiles')
      .update({ avatar_config: newConfig })
      .eq('id', userId);
    if (err) setError(err.message);
    else     setConfig(mergeConfig(newConfig));
    setLoading(false);
    return !err;
  }, [userId]);

  return { config, save, loading, error };
}
