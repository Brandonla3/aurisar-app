import { useEffect, useRef } from 'react';

export function useScrollReveal() {
  const obs = useRef(null);
  useEffect(() => {
    obs.current = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('scroll-visible');
          obs.current.unobserve(e.target);
        }
      }),
      { threshold: 0.05 }
    );
    return () => obs.current.disconnect();
  }, []);
  return el => { if (el && obs.current) obs.current.observe(el); };
}
