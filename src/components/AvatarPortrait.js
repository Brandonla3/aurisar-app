import React, { useState, useEffect } from 'react';

const Silhouette = (clsColor) =>
  React.createElement('div', {
    style: {
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
    }
  },
    React.createElement('svg', {
      viewBox: '0 0 100 150', fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      style: { width: '70%', height: '70%' },
    },
      React.createElement('circle', { cx: 50, cy: 38, r: 22, fill: 'rgba(180,172,158,0.18)' }),
      React.createElement('path', { d: 'M10 148 C10 105 90 105 90 148', fill: 'rgba(180,172,158,0.18)' })
    ),
    React.createElement('span', {
      style: {
        fontSize: '.55rem', color: 'rgba(180,172,158,0.4)',
        textAlign: 'center', position: 'absolute', bottom: 10,
      }
    }, 'Portrait render pending')
  );

export default function AvatarPortrait({
  gender = 'male',
  outfit = 'ma_casual',
  clsColor = '#8B6A3E',
  previewVersion = null,
  isRendering = false,
}) {
  const staticSrc  = `/avatars/${gender}_${outfit}.png`;
  const previewSrc = previewVersion != null
    ? `/avatars/portrait_preview.png?v=${previewVersion}`
    : null;
  const primary  = previewSrc || staticSrc;
  const fallback = `/avatars/${gender}_default.png`;

  const [src, setSrc] = useState(primary);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(primary);
    setFailed(false);
  }, [primary]);

  const handleError = () => {
    if (src !== fallback) { setSrc(fallback); }
    else { setFailed(true); }
  };

  return React.createElement('div', {
    style: {
      width: '100%', maxWidth: 220, margin: '0 auto',
      aspectRatio: '2/3', borderRadius: 10, overflow: 'hidden',
      border: `2px solid ${clsColor}55`, background: '#14120e',
      position: 'relative', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }
  },
    failed
      ? Silhouette(clsColor)
      : React.createElement('img', {
          src, alt: 'avatar portrait', onError: handleError,
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                   transition: 'opacity .3s', opacity: isRendering ? 0.4 : 1 },
        }),
    // Rendering spinner overlay
    isRendering && React.createElement('div', {
      style: {
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,8,6,0.55)',
        gap: 8,
      }
    },
      React.createElement('div', {
        style: {
          width: 28, height: 28, borderRadius: '50%',
          border: `3px solid ${clsColor}44`,
          borderTopColor: clsColor,
          animation: 'spin 0.8s linear infinite',
        }
      }),
      React.createElement('span', {
        style: { fontSize: '.6rem', color: `${clsColor}cc`, letterSpacing: 1 }
      }, 'RENDERING')
    ),
    React.createElement('div', {
      style: {
        position: 'absolute', inset: 0, borderRadius: 8,
        boxShadow: `inset 0 0 0 1px ${clsColor}33`, pointerEvents: 'none',
      }
    })
  );
}
