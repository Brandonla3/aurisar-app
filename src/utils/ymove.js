import React from 'react';
import { EXERCISES } from '../data/exercises';
import { EX_BY_ID } from '../data/constants';

let _ymoveLoaded = false;
let _ymoveCallbacks = [];

function _notifyYMoveLoaded() {
  _ymoveLoaded = true;
  _ymoveCallbacks.forEach(fn => fn());
  _ymoveCallbacks = [];
}
function onYMoveLoaded(fn) {
  if (_ymoveLoaded) { fn(); return; }
  _ymoveCallbacks.push(fn);
}

async function loadYMoveExercises() {
  if (_ymoveLoaded) return;
  try {
    const { data, error } = await sb
      .from('exercise_library')
      .select('*')
      .order('name');
    if (error) throw error;
    if (!data || data.length === 0) { _notifyYMoveLoaded(); return; }

    const existingIds = new Set(EXERCISES.map(e => e.id));
    let added = 0, patched = 0;

    for (const ex of data) {
      // Map Supabase columns → app exercise shape
      const appEx = {
        id:              ex.id,
        name:            ex.name,
        category:        ex.category || 'strength',
        secondaryCategory: null,
        muscleGroup:     ex.muscle_group || ex.muscleGroup || 'back',
        icon:            ex.icon || '🏋️',
        baseXP:          ex.base_xp || ex.baseXP || 40,
        muscles:         ex.muscle_group
                           ? (ex.muscle_group.charAt(0).toUpperCase() + ex.muscle_group.slice(1))
                           : '',
        desc:            ex.description || '',
        tips:            [],
        images:          [],
        equipment:       ex.equipment || 'bodyweight',
        difficulty:      ex.difficulty || 'Intermediate',
        classAffinity:   ex.class_affinity || 'all',
        exerciseType:    ex.exercise_type || '',
        pbType:          ex.pb_type || null,
        pbTier:          ex.pb_tier || 'Personal',
        wodViable:       ex.wod_viable || false,
        compound:        ex.compound || false,
        calisthenics:    ex.calisthenics || false,
        olympic:         ex.olympic || false,
        plyometric:      ex.plyometric || false,
        isolation:       ex.isolation || false,
        tracksWeight:    ex.tracks_weight || false,
        tracksDistance:  ex.tracks_distance || false,
        tracksIncline:   ex.tracks_incline || false,
        defaultSets:     ex.default_sets || null,
        defaultReps:     ex.default_reps || null,
        defaultDurationMin: ex.default_duration_min || null,
        hasTreadmill:    ex.id === 'treadmill_run' || ex.id === 'treadmill_walk' || ex.id === 'stairmaster',
        hasElliptical:   ex.id === 'elliptical',
        videoUrl:        ex.video_url || null,
        thumbnailUrl:    ex.thumbnail_url || null,
        ymoveUuid:       ex.ymove_uuid || null,
        ymoveSlug:       ex.ymove_slug || null,
        hasVideo:        ex.has_video || false,
        urlExpiresAt:    ex.url_expires_at || null,
        xpClassMap:      ex.xp_class_map || {},
        _source:         ex.source || 'aurisar',
      };

      if (existingIds.has(appEx.id)) {
        // Patch existing exercise with video + enriched data from Supabase
        const existing = EXERCISES.find(e => e.id === appEx.id);
        if (existing) {
          existing.videoUrl     = appEx.videoUrl;
          existing.thumbnailUrl = appEx.thumbnailUrl;
          existing.urlExpiresAt = appEx.urlExpiresAt;
          existing.hasVideo     = appEx.hasVideo;
          existing.equipment    = appEx.equipment;
          existing.difficulty   = appEx.difficulty;
          existing.pbType       = appEx.pbType;
          existing.pbTier       = appEx.pbTier;
          existing.xpClassMap   = appEx.xpClassMap;
          existing._source      = 'patched';
        }
        patched++;
      } else {
        EXERCISES.push(appEx);
        existingIds.add(appEx.id);
        added++;
      }
    }

    // Rebuild global lookup
    Object.assign(EX_BY_ID, Object.fromEntries(EXERCISES.map(e => [e.id, e])));
    console.log(`✅ Exercise library loaded: ${data.length} from Supabase (${added} new, ${patched} patched)`);
  } catch (err) {
    console.warn('Exercise library load failed (using hardcoded set):', err.message);
  }
  _notifyYMoveLoaded();
}

// Re-render hook — triggers when YMove exercises finish loading
function useYMoveExercises() {
  const [ready, setReady] = React.useState(_ymoveLoaded);
  React.useEffect(() => {
    if (!_ymoveLoaded) onYMoveLoaded(() => setReady(true));
  }, []);
  return ready;
}

// -- Video URL fetcher via Supabase RPC (server-side, no CORS) --
const _ymoveFetchCache = {}; // prevents duplicate in-flight requests

async function getFreshVideoUrl(exerciseId) {
  const ex = EX_BY_ID[exerciseId];
  if (!ex) return null;

  // If exercise has no YMove mapping and no existing URL, nothing to do
  if (!ex.hasVideo && !ex.videoUrl) return null;

  // Check if we have a valid in-memory cached URL (30+ min remaining)
  if (ex.videoUrl) {
    const expiresAt   = ex.urlExpiresAt ? new Date(ex.urlExpiresAt).getTime() : 0;
    const msRemaining = expiresAt - Date.now();
    if (msRemaining > 30 * 60 * 1000) return ex.videoUrl;
  }

  // Deduplicate concurrent requests for same exercise
  if (_ymoveFetchCache[exerciseId]) return _ymoveFetchCache[exerciseId];

  const promise = (async () => {
    try {
      // Call server-side RPC — this handles YMove API call + Supabase caching
      const { data, error } = await sb.rpc('get_ymove_video_url', { p_exercise_id: exerciseId });
      if (error) { console.warn('Video RPC error:', error.message); return null; }
      if (!data || data.error || !data.video_url) {
        if (data?.error) console.warn('YMove:', data.error);
        return null;
      }

      // Update in-memory cache
      if (EX_BY_ID[exerciseId]) {
        EX_BY_ID[exerciseId].videoUrl     = data.video_url;
        EX_BY_ID[exerciseId].thumbnailUrl = data.thumbnail_url || EX_BY_ID[exerciseId].thumbnailUrl;
        EX_BY_ID[exerciseId].urlExpiresAt = data.expires_at;
        EX_BY_ID[exerciseId].hasVideo     = true;
      }

      return data.video_url;
    } catch (e) {
      console.warn('Video fetch error:', e.message);
      return null;
    } finally {
      delete _ymoveFetchCache[exerciseId];
    }
  })();

  _ymoveFetchCache[exerciseId] = promise;
  return promise;
}

export { _notifyYMoveLoaded, onYMoveLoaded, loadYMoveExercises, useYMoveExercises, getFreshVideoUrl };
