import React from 'react';
import { EX_BY_ID } from '../data/constants';
import { getFreshVideoUrl } from '../utils/ymove';

function ExerciseVideo({ exerciseId, height = 260 }) {
  const ex = EX_BY_ID[exerciseId];
  const [url, setUrl] = React.useState(ex?.videoUrl || null);
  const [loading, setLoading] = React.useState(!ex?.videoUrl && ex?.hasVideo);
  const [retries, setRetries] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    if (exerciseId && (EX_BY_ID[exerciseId]?.hasVideo || EX_BY_ID[exerciseId]?.ymoveSlug)) {
      setLoading(true);
      getFreshVideoUrl(exerciseId).then(u => {
        if (!cancelled) { setUrl(u); setLoading(false); }
      });
    } else {
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [exerciseId]);

  const containerStyle = {
    width:'100%', height, borderRadius:10, overflow:'hidden',
    background:'#0c0c0a', display:'flex', alignItems:'center',
    justifyContent:'center', marginBottom:10,
  };

  // Loading state
  if (loading && !url) return React.createElement('div', { style:{...containerStyle, flexDirection:'column', gap:6} },
    React.createElement('div', { style:{width:28,height:28,border:'2px solid rgba(180,172,158,.12)',borderTopColor:'#b4ac9e',borderRadius:'50%',animation:'spin .8s linear infinite'} }),
    React.createElement('span', { style:{fontSize:'.62rem', color:'#5a5650', fontStyle:'italic'} }, 'Loading video\u2026')
  );

  // No video available
  if (!url) return React.createElement('div', { style:{...containerStyle, flexDirection:'column', gap:6} },
    React.createElement('span', { style:{fontSize:'2.5rem'} }, ex?.icon || '\uD83C\uDFCB\uFE0F'),
    React.createElement('span', { style:{fontSize:'.68rem', color:'#4a4438', fontStyle:'italic'} },
      ex ? 'No video available' : 'Loading\u2026')
  );

  // Video player
  return React.createElement('video', {
    key: url, src: url, poster: ex?.thumbnailUrl,
    controls: true, loop: true, playsInline: true, preload: 'metadata',
    style: { width:'100%', height:'100%', objectFit:'contain' },
    onError: () => {
      if (retries < 2) {
        // Force re-fetch on error (URL may have expired mid-session)
        if (EX_BY_ID[exerciseId]) {
          EX_BY_ID[exerciseId].videoUrl = null;
          EX_BY_ID[exerciseId].urlExpiresAt = null;
        }
        setRetries(r => r + 1); setUrl(null); setLoading(true);
        getFreshVideoUrl(exerciseId).then(u => { setUrl(u); setLoading(false); });
      }
    },
  });
}

export { ExerciseVideo };
