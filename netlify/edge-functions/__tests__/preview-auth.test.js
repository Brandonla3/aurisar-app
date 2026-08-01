import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, {
  isAuthorized,
  safeEqual,
  shouldGate,
} from '../preview-auth.js';

const USER = 'previewer';
const PASS = 's3cr3t-pass:with-colon';

function basic(user, pass) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

/** Install a fake Netlify.env (credentials) backed by the given map. */
function withEnv(env) {
  const prev = globalThis.Netlify;
  globalThis.Netlify = {
    env: {
      get: (key) => env[key],
      has: (key) => env[key] !== undefined,
    },
  };
  return () => {
    globalThis.Netlify = prev;
  };
}

/** A sentinel returned by context.next() so we can assert pass-through. */
const NEXT = Symbol('next');

/**
 * Build a Context like the one Netlify passes to an edge function. The deploy
 * context is read at runtime from `context.deploy.context` (the build-time
 * CONTEXT env var is not available at the edge).
 */
function ctx(deployContext) {
  return { deploy: { context: deployContext }, next: vi.fn(() => NEXT) };
}

function req(headers = {}) {
  return new Request('https://preview.example/', { headers });
}

afterEach(() => {
  delete globalThis.Netlify;
});

describe('shouldGate', () => {
  it('gates only public, non-production deploy contexts', () => {
    expect(shouldGate('deploy-preview')).toBe(true);
    expect(shouldGate('branch-deploy')).toBe(true);
  });

  it('never gates production, local dev, or unknown contexts', () => {
    expect(shouldGate('production')).toBe(false);
    expect(shouldGate('dev')).toBe(false);
    expect(shouldGate('')).toBe(false);
    expect(shouldGate(undefined)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('is true only for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('rejects non-string inputs', () => {
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual('abc', null)).toBe(false);
  });
});

describe('isAuthorized', () => {
  it('accepts correct credentials', () => {
    expect(isAuthorized(basic(USER, PASS), USER, PASS)).toBe(true);
  });

  it('preserves colons in the password', () => {
    expect(isAuthorized(basic(USER, 'a:b:c'), USER, 'a:b:c')).toBe(true);
  });

  it('rejects a wrong password or wrong user', () => {
    expect(isAuthorized(basic(USER, 'nope'), USER, PASS)).toBe(false);
    expect(isAuthorized(basic('nope', PASS), USER, PASS)).toBe(false);
  });

  it('rejects missing, malformed, or non-Basic headers', () => {
    expect(isAuthorized(null, USER, PASS)).toBe(false);
    expect(isAuthorized('', USER, PASS)).toBe(false);
    expect(isAuthorized(`Bearer ${btoa(`${USER}:${PASS}`)}`, USER, PASS)).toBe(false);
    expect(isAuthorized('Basic', USER, PASS)).toBe(false);
    expect(isAuthorized('Basic @@not-base64@@', USER, PASS)).toBe(false);
    expect(isAuthorized(`Basic ${btoa('no-colon-here')}`, USER, PASS)).toBe(false);
  });
});

describe('handler (default export)', () => {
  it('passes production through without touching auth', async () => {
    const restore = withEnv({});
    const context = ctx('production');
    const res = await handler(req(), context);
    expect(res).toBe(NEXT);
    expect(context.next).toHaveBeenCalledTimes(1);
    restore();
  });

  it('passes local dev through', async () => {
    const restore = withEnv({});
    const context = ctx('dev');
    const res = await handler(req(), context);
    expect(res).toBe(NEXT);
    restore();
  });

  it('returns 503 when a gated deploy has no credentials configured', async () => {
    const restore = withEnv({});
    const context = ctx('deploy-preview');
    const res = await handler(req(), context);
    expect(res.status).toBe(503);
    expect(context.next).not.toHaveBeenCalled();
    restore();
  });

  it('challenges with 401 when no auth header is sent', async () => {
    const restore = withEnv({
      PREVIEW_BASIC_AUTH_USER: USER,
      PREVIEW_BASIC_AUTH_PASSWORD: PASS,
    });
    const context = ctx('deploy-preview');
    const res = await handler(req(), context);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(context.next).not.toHaveBeenCalled();
    restore();
  });

  it('challenges with 401 on wrong credentials', async () => {
    const restore = withEnv({
      PREVIEW_BASIC_AUTH_USER: USER,
      PREVIEW_BASIC_AUTH_PASSWORD: PASS,
    });
    const context = ctx('branch-deploy');
    const res = await handler(req({ authorization: basic(USER, 'wrong') }), context);
    expect(res.status).toBe(401);
    expect(context.next).not.toHaveBeenCalled();
    restore();
  });

  it('lets the request through on correct credentials', async () => {
    const restore = withEnv({
      PREVIEW_BASIC_AUTH_USER: USER,
      PREVIEW_BASIC_AUTH_PASSWORD: PASS,
    });
    const context = ctx('deploy-preview');
    const res = await handler(req({ authorization: basic(USER, PASS) }), context);
    expect(res).toBe(NEXT);
    expect(context.next).toHaveBeenCalledTimes(1);
    restore();
  });
});
