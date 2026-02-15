/**
 * Copies dist/ into demo/dist/ so the demo folder is self-contained for
 * local serve and for publishing (e.g. GH Pages). Run from javascript/.
 */
import { cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');
const demoDist = join(root, 'demo', 'dist');

if (!existsSync(dist)) {
  console.error('Run "npm run build" first.');
  process.exit(1);
}

cpSync(dist, demoDist, { recursive: true });
console.log('Copied dist/ → demo/dist/');
