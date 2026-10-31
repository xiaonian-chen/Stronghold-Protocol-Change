// scripts/20p-loader.mjs — 20p custom module injection: registers a module resolution hook
// that intercepts Node.js imports and redirects them to 20p/ versions when available.
// The hook runs before ANY module is loaded (via --import flag), so the original files
// on disk remain SHA-256-clean for MANIFEST.json verification.
//
// Start the server with:
//   node --import ./scripts/20p-loader.mjs server/index.js
//
// When the upstream sends an update package (UPDATE.json), the original files pass
// MANIFEST.json SHA-256 verification because they are untouched. After verification,
// the hook serves 20p-modified versions transparently.
//
// The hook applies to every official version, not just the default one: a non-default version's match runs in a
// child process (server/match/host/index.js) that re-emits this process's --import flags to its own execArgv, so
// the same overrides load there (a sandboxed script host, SP_PLUGIN_SCRIPTS=sandbox, deliberately does not).

import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The main hook file handles resolve & load
register('./20p/resolver.mjs', import.meta.url);