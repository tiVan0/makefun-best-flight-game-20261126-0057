// main.ts — the hand-in program for Operasi Garuda Senja (Node 22, stdlib only).
// It copies this repository's game/ and screenshots/ into the grader's output
// directory and writes dossier.json there with the vendored make.fun library,
// so the judge can read the game and its screenshots. Run it twice and the
// bytes are identical; outside the grader, MAKEFUN_OUTPUT_DIR stands in
// for /output, e.g.:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game first: every static file under game/, then the screenshots.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });

const shotsOut = join(outputDir, 'screenshots');
mkdirSync(shotsOut, { recursive: true });
const shotsIn = join(repoRoot, 'screenshots');
if (existsSync(shotsIn)) cpSync(shotsIn, shotsOut, { recursive: true });

// The dossier caps come from the competition's gate: the text budget shapes
// the bytes, the rest only refuse an entry the scorer would refuse anyway
// (a screenshot over 256 KiB, more than 4 of them, game/ over 993 files or
// 48 MiB, a game path over 1000 bytes). The caps are one constant so both
// runs of this program — the grader runs it twice — build the same dossier.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};
const dossier = buildDossier(outputDir, DOSSIER_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);
