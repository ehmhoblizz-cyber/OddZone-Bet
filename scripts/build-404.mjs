// Generates 404.html as a copy of index.html.
//
// WHY: this app is a single-page application served as static files. A static
// host (GitHub Pages, Netlify, Vercel) answers an unmatched path — or a deep
// link such as /games/star-shooter-3d/index.html — with 404.html. When 404.html
// is a standalone "Page not found" card, the browser loads THAT instead of the
// app, so the shell never boots and the game looks like it was moved or
// deleted. Copying the app shell into 404.html makes every unknown path fall
// back to index.html, which is the standard static-host SPA fallback.
//
// The copy is byte-for-byte on purpose: index.html is self-contained (its
// scripts are loaded with relative paths), so the duplicate behaves identically
// from any directory depth the host serves it at.
//
// Run with:  node scripts/build-404.mjs   (or: npm run build)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

const source = join(projectRoot, 'index.html');
const target = join(projectRoot, '404.html');

async function main() {
    let html;
    try {
        html = await readFile(source);
    } catch (error) {
        console.error(`[build-404] Cannot read ${source}: ${error.message}`);
        process.exitCode = 1;
        return;
    }

    if (html.length === 0) {
        console.error(`[build-404] Refusing to copy an empty ${source}.`);
        process.exitCode = 1;
        return;
    }

    // Skip the write when nothing changed, so the deploy stays quiet and
    // 404.html does not churn on every build.
    try {
        const existing = await readFile(target);
        if (existing.equals(html)) {
            console.log(`[build-404] 404.html already matches index.html (${html.length} bytes) — nothing to do.`);
            return;
        }
    } catch (error) {
        // No existing 404.html yet: fall through and create it.
    }

    await writeFile(target, html);
    console.log(`[build-404] Wrote 404.html as a copy of index.html (${html.length} bytes).`);
}

main();
