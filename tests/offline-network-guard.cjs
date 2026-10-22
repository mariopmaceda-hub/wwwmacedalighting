'use strict';
// Test-process defense in depth. PGlite also has no real pg_net/pg_cron extension.
// This deliberately blocks outbound APIs; it does not mock a successful request.
const state = { attempts: 0 };
// PGlite 0.3.14's only process.binding call asks for filesystem flag constants.
// Supply public read-only constants, not a native binding; all other requests fail.
const fsFlags = Object.freeze({ ...require('node:fs').constants });
Object.defineProperty(process, 'binding', {
  value(name) {
    if (name === 'constants') return Object.freeze({ fs: fsFlags });
    throw new Error('Native process bindings are disabled in isolated migration tests');
  }, writable: false, configurable: false,
});
const deny = function () {
  state.attempts++;
  const error = new Error('Outbound networking is disabled for isolated migration tests');
  error.code = 'ERR_TEST_NETWORK_DISABLED';
  throw error;
};
const replace = (object, key) => {
  if (key in object) Object.defineProperty(object, key, { value: deny, writable: false, configurable: false });
};
// Load both first: https initializes an Agent subclass of http.Agent.
for (const mod of [require('node:http'), require('node:https')]) {
  for (const key of ['request', 'get']) replace(mod, key);
  replace(mod.Agent.prototype, 'createConnection');
}
const net = require('node:net');
for (const key of ['connect', 'createConnection', 'createServer']) replace(net, key);
replace(net.Socket.prototype, 'connect');
replace(net.Server.prototype, 'listen');
replace(require('node:tls'), 'connect');
replace(require('node:dgram'), 'createSocket');
for (const name of ['dns', 'dns/promises']) {
  const mod = require('node:' + name);
  // Resolver instances have native DNS methods independent of module exports.
  if (mod.Resolver) {
    for (const key of Object.getOwnPropertyNames(mod.Resolver.prototype)) {
      if (/^(?:resolve|reverse)/.test(key)) replace(mod.Resolver.prototype, key);
    }
    replace(mod, 'Resolver');
  }
  for (const key of Object.keys(mod)) if (/^(?:lookup|resolve|reverse)/.test(key)) replace(mod, key);
}
replace(globalThis, 'fetch');
replace(globalThis, 'WebSocket');
Object.defineProperty(globalThis, '__migrationOfflineGuard', { value: state, writable: false, configurable: false });
