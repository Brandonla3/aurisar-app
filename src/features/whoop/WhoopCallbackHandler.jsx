import { useEffect, useState } from 'react';
import { sb } from '../../utils/supabase';

export default function WhoopCallbackHandler() {
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');

  useEffect(() => {
    const params      = new URLSearchParams(window.location.search);
    const code        = params.get('code');
    const state       = params.get('state');
    const oauthError  = params.get('error');
    const oauthErrDesc = params.get('error_description');
    const savedState  = sessionStorage.getItem('whoop_oauth_state');

    if (oauthError) {
      setStatus('error');
      setErrorDetail(`Whoop returned error: ${oauthError}${oauthErrDesc ? ` — ${oauthErrDesc}` : ''}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorDetail('Missing authorization code in callback URL.');
      return;
    }

    if (state !== savedState) {
      setStatus('error');
      setErrorDetail(`State mismatch. URL state="${state}", saved="${savedState ?? '(none)'}". sessionStorage may have been cleared.`);
      return;
    }
    sessionStorage.removeItem('whoop_oauth_state');

    (async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
          setStatus('error');
          setErrorDetail('No Supabase session — please sign in to Aurisar first, then reconnect Whoop.');
          return;
        }

        const res = await fetch('/.netlify/functions/whoop-token-exchange', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code }),
        });

        if (res.ok) {
          setStatus('success');
          setTimeout(() => { window.location.replace('/'); }, 1800);
        } else {
          let body = '';
          try { body = await res.text(); } catch { /* ignore */ }
          setStatus('error');
          setErrorDetail(`Token exchange failed (HTTP ${res.status}). Response: ${body || '(empty)'}`);
        }
      } catch (e) {
        setStatus('error');
        setErrorDetail(`Network or runtime error: ${e?.message ?? String(e)}`);
      }
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
          {errorDetail && (
            <div style={{
              fontSize: 12,
              color: '#c4b8a4',
              background: '#1a1a16',
              border: '1px solid #2a2a24',
              padding: '12px 16px',
              borderRadius: 8,
              maxWidth: 600,
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              textAlign: 'left',
              userSelect: 'text',
            }}>
              {errorDetail}
            </div>
          )}
          <button
            onClick={() => { window.location.replace('/'); }}
            style={{
              marginTop: 8,
              padding: '8px 16px',
              background: '#2a2a24',
              color: '#d4cec4',
              border: '1px solid #3a3a34',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Return to app
          </button>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
