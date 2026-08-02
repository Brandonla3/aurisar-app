/**
 * kill_net.mjs — preload hook (node --import) that turns any outbound network
 * attempt into a crash. Used by terrain_sync_state.test.mjs to prove the
 * build-path terrain sync stays fully offline, and manually via
 *   NODE_OPTIONS="--import <file-url-to-this-file>" npm run build
 * to simulate a network-blocked CI/deploy environment.
 *
 * SCOPE: this patches the fetch/http(s) API surface only — NOT net.Socket,
 * raw undici dispatchers, or DNS. That is deliberate: node uses `net` for
 * local IPC too (e.g. Windows named pipes in build tooling), so blocking it
 * would crash offline-legitimate work. Sufficient to catch a reintroduced
 * download in the terrain scripts (which use global fetch); do not treat it
 * as a universal network firewall.
 */

import http from 'node:http';
import https from 'node:https';

function deny(what) {
  return () => {
    throw new Error(`[kill-net] blocked ${what} — the build path must not touch the network`);
  };
}

globalThis.fetch = deny('fetch()');
http.request = deny('http.request');
http.get = deny('http.get');
https.request = deny('https.request');
https.get = deny('https.get');
