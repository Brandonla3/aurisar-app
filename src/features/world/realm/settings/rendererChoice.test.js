import { describe, expect, it } from 'vitest';
import { chooseRenderer, RENDERER, RENDERER_PREF } from './rendererChoice.js';

describe('chooseRenderer', () => {
  it('defaults to WebGL2 even when WebGPU is available', () => {
    // The whole point of the policy: 'auto' never opts a player into WebGPU.
    const r = chooseRenderer({ pref: RENDERER_PREF.AUTO, hasWebGPU: true });
    expect(r.renderer).toBe(RENDERER.WEBGL2);
    expect(r.reason).toBe('auto-default');
    expect(r.requestedFallback).toBe(false);
  });

  it('honours an explicit WebGPU request when supported', () => {
    const r = chooseRenderer({ pref: RENDERER_PREF.WEBGPU, hasWebGPU: true });
    expect(r.renderer).toBe(RENDERER.WEBGPU);
    expect(r.requestedFallback).toBe(false);
  });

  it('falls back to WebGL2 when WebGPU is requested but missing, and says so', () => {
    const r = chooseRenderer({ pref: RENDERER_PREF.WEBGPU, hasWebGPU: false });
    expect(r.renderer).toBe(RENDERER.WEBGL2);
    expect(r.reason).toBe('webgpu-unavailable');
    // The flag exists so the panel can show "WebGPU unavailable on this device"
    // instead of silently flipping the toggle back.
    expect(r.requestedFallback).toBe(true);
  });

  it('records iOS separately when WebGPU is explicitly chosen there', () => {
    const r = chooseRenderer({ pref: RENDERER_PREF.WEBGPU, hasWebGPU: true, isIOS: true });
    expect(r.renderer).toBe(RENDERER.WEBGPU);
    expect(r.reason).toBe('explicit-webgpu-ios');
  });

  it('honours an explicit WebGL2 request regardless of capability', () => {
    const r = chooseRenderer({ pref: RENDERER_PREF.WEBGL2, hasWebGPU: true });
    expect(r.renderer).toBe(RENDERER.WEBGL2);
    expect(r.reason).toBe('explicit-webgl2');
  });

  it('treats unknown preferences as auto rather than throwing', () => {
    // Persisted prefs outlive code. A stale localStorage value must not brick boot.
    const r = chooseRenderer({ pref: 'quantum', hasWebGPU: true });
    expect(r.renderer).toBe(RENDERER.WEBGL2);
  });

  it('works with no arguments at all', () => {
    expect(chooseRenderer().renderer).toBe(RENDERER.WEBGL2);
  });
});
