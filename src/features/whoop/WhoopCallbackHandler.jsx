import { useEffect, useState } from 'react';
import { sb } from '../../utils/supabase';

export default function WhoopCallbackHandler() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const code      = params.get('code');
    const state     = params.get('state');
    const savedState = sessionStorage.getItem('whoop_oauth_state');

    if (!code || state !== savedState) {
      setStatus('error');
      setTimeout(() => { window.location.replace('/'); }, 2500);
      return;
    }
    sessionStorage.removeItem('whoop_oauth_state');

    (async () => {
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) {
          window.location.replace('/');
          return;
        }

        const res = await fetch('/.netlify/functions/whoop-token-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, userId: user.id }),
        });

        setStatus(res.ok ? 'success' : 'error');
      } catch {
        setStatus('error');
      }
      setTimeout(() => { window.location.replace('/'); }, 1800);
    })();
  }, []);

  const card = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100dvh',
    background: '#0c0c0a',
    color: '#d4cec4',
    fontFamily: "'Inter', sans-serif",
    gap: 12,
  };

  return (
    <div style={card}>
      {status === 'loading' && (
        <>
          <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>⟳</div>
          <div style={{ fontSize: 16 }}>Connecting Whoop...</div>
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ fontSize: 40, color: '#2ecc71' }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Whoop connected!</div>
          <div style={{ fontSize: 13, color: '#8a8478' }}>Returning to app...</div>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: 40, color: '#e74c3c' }}>✗</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Connection failed</div>
          <div style={{ fontSize: 13, color: '#8a8478' }}>Returning to app...</div>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
