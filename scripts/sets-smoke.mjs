#!/usr/bin/env node
/**
 * Set viewer smoke test.
 *
 * The unit tests cover the maths and the scene graph, but nothing in vitest has
 * a WebGL context — so until this runs, no part of the viewer has drawn a
 * pixel. This boots the real Vite dev server, loads the real scene module
 * against a procedurally built splat environment, renders all four passes in a
 * real browser, and checks the pixels came out the way each pass claims.
 *
 *   node scripts/sets-smoke.mjs
 *
 * Headless Chromium needs SwiftShader for WebGL2, which is why the launch flags
 * are here rather than relying on defaults.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAGE = '/tests/smoke/set-viewer-smoke.html';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

// configFile:false is essential — the project's own vite.config.ts carries
// vite-plugin-electron, which would boot the whole desktop app against this
// throwaway server instead of just serving the page.
const server = await createServer({
  configFile: false,
  root: ROOT,
  resolve: { alias: { '@': path.join(ROOT, 'src') } },
  server: { port: 5199, strictPort: true },
});
await server.listen();
const base = `http://localhost:${server.config.server.port}`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let result;
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [page error] ${message.text()}`);
  });

  await page.goto(`${base}${PAGE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__SMOKE__?.status !== 'running', null, { timeout: 120_000 });
  result = await page.evaluate(() => window.__SMOKE__);
} finally {
  await browser.close();
  await server.close();
}

if (result.status === 'error') {
  console.error('\nThe viewer threw before it could render:\n');
  for (const error of result.errors) console.error(error);
  process.exit(1);
}

const { passes, plateAfterDepth } = result;
console.log('\nPass analysis:');
for (const [kind, data] of Object.entries(passes)) {
  console.log(`  ${kind.padEnd(10)} lit=${data.litFraction.toFixed(3)} grey=${data.greyFraction.toFixed(3)} ` +
    `rgb=${data.meanR.toFixed(0)},${data.meanG.toFixed(0)},${data.meanB.toFixed(0)}`);
}
console.log('');

check('the procedural splat environment loaded', result.splatLoaded === true);

for (const kind of ['plate', 'composite', 'depth', 'standin']) {
  const pass = passes[kind];
  check(`${kind}: returned a full RGBA buffer`, pass && pass.bytes === 320 * 180 * 4,
    pass ? `${pass.bytes} bytes` : 'missing');
  check(`${kind}: drew something`, pass && pass.litFraction > 0.01,
    pass ? `${(pass.litFraction * 100).toFixed(1)}% of frame` : 'missing');
}

// The plate is the environment with no stand-ins; the stand-in pass is the
// mannequin with no environment. If visibility toggling were broken, these two
// would look alike.
check('plate holds less mannequin grey than the stand-in pass',
  passes.plate.greyFraction < passes.standin.greyFraction,
  `plate=${passes.plate.greyFraction.toFixed(3)} standin=${passes.standin.greyFraction.toFixed(3)}`);

check('the composite is brighter than the stand-in pass alone',
  passes.composite.litFraction > passes.standin.litFraction,
  `composite=${passes.composite.litFraction.toFixed(3)} standin=${passes.standin.litFraction.toFixed(3)}`);

// Depth is a distance ramp, so its channels track each other closely; the
// colour passes do not, because the environment is deliberately tinted.
const depthSpread = Math.max(
  Math.abs(passes.depth.meanR - passes.depth.meanG),
  Math.abs(passes.depth.meanG - passes.depth.meanB),
);
const plateSpread = Math.max(
  Math.abs(passes.plate.meanR - passes.plate.meanG),
  Math.abs(passes.plate.meanG - passes.plate.meanB),
);
check('depth is near-greyscale', depthSpread < 12, `channel spread ${depthSpread.toFixed(1)}`);
check('the colour passes are not greyscale', plateSpread > depthSpread,
  `plate spread ${plateSpread.toFixed(1)} vs depth ${depthSpread.toFixed(1)}`);

// The regression that shipped and was fixed: setDepthColor installs a world
// modifier, so an incomplete restore leaves every later render depth-coloured.
const drift = Math.abs(plateAfterDepth.meanR - passes.plate.meanR)
  + Math.abs(plateAfterDepth.meanG - passes.plate.meanG)
  + Math.abs(plateAfterDepth.meanB - passes.plate.meanB);
check('the depth pass does not leak into later renders', drift < 8,
  `plate drifted ${drift.toFixed(1)} after a depth pass`);

// Splats are mostly transparent, so they must blend with each other rather than
// depth-reject each other, while still being hidden by opaque geometry. Those
// two pull in opposite directions and are what depthTest/depthWrite balance.
check('overlapping splats blend instead of rejecting each other', result.overlapBlends === true);
check('opaque foreground still occludes splats', result.foregroundOccludes === true);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
