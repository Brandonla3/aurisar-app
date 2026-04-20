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

export default function AvatarPortrait({ gender = 'male', outfit = 'ma_casual', clsColor = '#8B6A3E' }) {
  const primary = `/avatars/${gender}_${outfit}.png`;
  const fallback = `/avatars/${gender}_default.png`;

  const [src, setSrc] = useState(primary);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(primary);
    setFailed(false);
  }, [primary]);

  const handleError = () => {
    if (src === primary) {
      setSrc(fallback);
    } else {
      setFailed(true);
    }
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
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        }),
    React.createElement('div', {
      style: {
        position: 'absolute', inset: 0, borderRadius: 8,
        boxShadow: `inset 0 0 0 1px ${clsColor}33`, pointerEvents: 'none',
      }
    })
  );
}
