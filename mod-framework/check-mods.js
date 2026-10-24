// mod-framework/check-mods.js — called by .bat to detect if any mod is enabled
// Exit code 0 = at least one mod enabled, exit code 1 = no mods enabled or config not found
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'config.json');

try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  for (const [, enabled] of Object.entries(config)) {
    if (enabled !== false) {
      process.exit(0);
    }
  }
  process.exit(1);
} catch {
  process.exit(1);
}