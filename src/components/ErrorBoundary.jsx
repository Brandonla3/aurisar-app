import React from 'react';

// React class component because ErrorBoundary requires lifecycle methods.
// Catches render-time errors anywhere below it in the tree, logs them, and
// shows a recovery UI instead of a white screen.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') {
      console.error('[Aurisar] Render error:', error, info?.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  reload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback(error, this.reset);
    }

    const wrap = {
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: 24, background: '#0c0c0a',
      color: '#d4cec4', fontFamily: 'Inter, sans-serif',
    };
    const card = {
      maxWidth: 480, width: '100%', padding: 28, borderRadius: 14,
      background: 'linear-gradient(145deg,rgba(45,42,36,.45),rgba(32,30,26,.25))',
      border: '1px solid rgba(180,172,158,.08)',
      boxShadow: '0 8px 40px rgba(0,0,0,.6)',
    };
    const h = {
      fontFamily: "'Cinzel', serif", fontSize: '1.4rem',
      letterSpacing: '.08em', color: '#c49428', marginBottom: 10,
    };
    const p = { fontSize: '.85rem', color: '#b4ac9e', lineHeight: 1.55, marginBottom: 18 };
    const pre = {
      fontSize: '.7rem', color: '#8a8478', background: 'rgba(0,0,0,.35)',
      padding: 10, borderRadius: 8, overflow: 'auto', maxHeight: 160,
      marginBottom: 18, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    };
    const btnRow = { display: 'flex', gap: 10 };
    const btn = {
      flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
      fontSize: '.7rem', fontWeight: 700, letterSpacing: '.08em',
      textTransform: 'uppercase', border: '1px solid rgba(180,172,158,.18)',
      background: 'linear-gradient(135deg,rgba(45,42,36,.5),rgba(45,42,36,.35))',
      color: '#d4cec4',
    };
    const btnGold = { ...btn, background: 'linear-gradient(135deg,#c49428,#8a6010)', color: '#fff', borderColor: '#c49428' };

    return (
      <div style={wrap} role="alert" aria-live="assertive">
        <div style={card}>
          <div style={h}>Something broke.</div>
          <div style={p}>
            Aurisar hit an unexpected error. Your saved data is safe — try reloading or going back to the home screen.
          </div>
          {error?.message && <pre style={pre}>{String(error.message)}</pre>}
          <div style={btnRow}>
            <button type="button" style={btn} onClick={this.reset}>Try again</button>
            <button type="button" style={btnGold} onClick={this.reload}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
