#!/usr/bin/env node
/**
 * Launches CineGen in Electron via Playwright and captures screenshots
 * of the key views for the GitHub README.
 *
 * Usage:
 *   npm run screenshots
 *
 * Screenshots are saved to ./screenshots/
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Force a solid background on transparent windows and capture */
async function takeScreenshot(page, name) {
  await sleep(1500);
  await page.evaluate(() => {
    document.documentElement.style.background = '#08090c';
    document.body.style.background = '#08090c';
  }).catch(() => {});
  await sleep(300);
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`  ✓ ${name}.png`);
}

/** Wait for the Project Manager window (has ?pm=1 in URL) */
async function waitForPMWindow(app) {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    for (const win of app.windows()) {
      try {
        if (win.url().includes('pm=1')) return win;
      } catch { /* destroyed */ }
    }
  }
  throw new Error('Timed out waiting for Project Manager window');
}

/** Wait for the main workspace window */
async function waitForMainWindow(app, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    for (const win of app.windows()) {
      try {
        const url = win.url();
        if (url.includes('pm=1') || url.includes('splash')) continue;
        const ready = await win.evaluate(() => {
          const root = document.getElementById('root');
          return root && root.childElementCount > 0;
        }).catch(() => false);
        if (ready) return win;
      } catch { /* destroyed */ }
    }
  }
  return null;
}

/**
 * Access the React workspace dispatch by walking the fiber tree.
 * Returns true if dispatch was successfully exposed on window.__dispatch.
 */
async function exposeDispatch(page) {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return false;
    // Walk React fiber tree to find WorkspaceContext provider
    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return false;
    let fiber = root[fiberKey];
    // Walk up/down to find the context provider
    const visited = new Set();
    const queue = [fiber];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      if (visited.size > 5000) break;
      // Look for context with dispatch
      if (node.memoizedState) {
        let state = node.memoizedState;
        while (state) {
          if (state.queue?.lastRenderedState?.activeTab !== undefined) {
            // Found the workspace reducer state — but we need the dispatch
          }
          const val = state.memoizedState;
          if (val && typeof val === 'object' && val.dispatch && val.state && val.state.activeTab !== undefined) {
            window.__cg_dispatch = val.dispatch;
            window.__cg_state = val.state;
            return true;
          }
          state = state.next;
        }
      }
      // Check context value on provider fibers
      if (node.memoizedProps?.value?.dispatch && node.memoizedProps?.value?.state?.activeTab !== undefined) {
        window.__cg_dispatch = node.memoizedProps.value.dispatch;
        window.__cg_state = () => node.memoizedProps.value.state;
        return true;
      }
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
      if (node.return) queue.push(node.return);
    }
    return false;
  });
}

/**
 * Add demo nodes to the Spaces/Create canvas and connect them with edges.
 */
async function populateSpacesCanvas(page) {
  // Add nodes at specific positions with data
  const nodes = [
    {
      nodeType: 'prompt',
      config: { prompt: 'A cinematic aerial shot of a coastal city at golden hour, dramatic lighting' },
      name: 'Scene Prompt',
    },
    {
      nodeType: 'shotPrompt',
      config: { shots: [
        { prompt: 'Wide establishing shot of skyline', duration: 5 },
        { prompt: 'Tracking shot through streets', duration: 4 },
        { prompt: 'Close-up of architecture details', duration: 3 },
      ]},
      name: 'Shot List',
    },
    {
      nodeType: 'compositionPlan',
      config: {
        positiveGlobalStyles: 'cinematic, film grain, anamorphic',
        negativeGlobalStyles: 'cartoon, anime',
        sections: [
          { name: 'Opening', positiveStyles: 'wide angle, dramatic', negativeStyles: '', durationMs: 15000, lines: 'establishing shots' },
          { name: 'Middle', positiveStyles: 'close-up, intimate', negativeStyles: '', durationMs: 20000, lines: 'character focus' },
        ],
      },
      name: 'Composition Plan',
    },
    {
      nodeType: 'musicPrompt',
      config: {
        style: 'orchestral',
        genre: 'cinematic',
        mood: 'epic, uplifting',
        tempo: '90 BPM',
        additionalNotes: 'Building crescendo in final section',
        generatedPrompt: 'An epic orchestral piece at 90 BPM with sweeping strings and brass...',
      },
      name: 'Score',
    },
    {
      nodeType: 'assetOutput',
      config: { name: 'Final Render' },
      name: 'Final Render',
    },
  ];

  // Add nodes one at a time with staggered positions
  for (let i = 0; i < nodes.length; i++) {
    const { nodeType, config, name } = nodes[i];
    await page.evaluate(({ nodeType, config, name }) => {
      window.dispatchEvent(new CustomEvent('cinegen:add-node-with-data', {
        detail: { nodeType, config: { ...config, name } }
      }));
    }, { nodeType, config, name });
    await sleep(200);
  }

  // Now reposition nodes and add edges via the workspace dispatch
  await sleep(500);
  const dispatched = await exposeDispatch(page);
  if (dispatched) {
    await page.evaluate(() => {
      const dispatch = window.__cg_dispatch;
      if (!dispatch) return;

      // Get current nodes from the provider
      const root = document.getElementById('root');
      const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
      let fiber = root[fiberKey];
      let currentNodes = [];
      let currentEdges = [];

      // Find the context provider to read current state
      const visited = new Set();
      const queue = [fiber];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        if (visited.size > 5000) break;
        if (node.memoizedProps?.value?.state?.nodes) {
          currentNodes = node.memoizedProps.value.state.nodes;
          currentEdges = node.memoizedProps.value.state.edges;
          break;
        }
        if (node.child) queue.push(node.child);
        if (node.sibling) queue.push(node.sibling);
      }

      if (currentNodes.length < 3) return;

      // Reposition nodes in a nice layout
      const positions = [
        { x: 100, y: 150 },    // prompt
        { x: 100, y: 400 },    // shotPrompt
        { x: 500, y: 100 },    // compositionPlan
        { x: 500, y: 400 },    // musicPrompt
        { x: 900, y: 250 },    // assetOutput
      ];

      const updatedNodes = currentNodes.map((n, i) => ({
        ...n,
        position: positions[i] || n.position,
      }));

      dispatch({ type: 'SET_NODES', nodes: updatedNodes });

      // Add edges connecting nodes
      const edges = [];
      if (updatedNodes.length >= 5) {
        const genId = () => Math.random().toString(36).slice(2, 10);
        // prompt → compositionPlan (conceptual flow)
        edges.push({
          id: `e-${genId()}`,
          source: updatedNodes[0].id,
          target: updatedNodes[2].id,
          sourceHandle: 'text',
          targetHandle: null,
          type: 'default',
        });
        // shotPrompt → assetOutput
        edges.push({
          id: `e-${genId()}`,
          source: updatedNodes[1].id,
          target: updatedNodes[4].id,
          sourceHandle: 'multi_prompt',
          targetHandle: 'video',
          type: 'default',
        });
        // compositionPlan → assetOutput
        edges.push({
          id: `e-${genId()}`,
          source: updatedNodes[2].id,
          target: updatedNodes[4].id,
          sourceHandle: 'composition_plan',
          targetHandle: 'image',
          type: 'default',
        });
        // musicPrompt → (visual connection)
        edges.push({
          id: `e-${genId()}`,
          source: updatedNodes[3].id,
          target: updatedNodes[4].id,
          sourceHandle: 'text',
          targetHandle: null,
          type: 'default',
        });

        dispatch({ type: 'SET_EDGES', edges: [...currentEdges, ...edges] });
      }
    });
    console.log('  ✓ Nodes positioned and connected');
  } else {
    console.log('  ⊘ Could not access dispatch — nodes added at default positions');
  }
}

/**
 * Add demo clips to the timeline on the Edit tab.
 */
async function populateTimeline(page) {
  const dispatched = await exposeDispatch(page);
  if (!dispatched) {
    console.log('  ⊘ Could not access dispatch for timeline');
    return;
  }

  await page.evaluate(() => {
    const dispatch = window.__cg_dispatch;
    if (!dispatch) return;

    const genId = () => Math.random().toString(36).slice(2, 10);

    // Create fake assets
    const assets = [
      { id: genId(), name: 'Aerial_CityGoldenHour.mp4', type: 'video', url: '', duration: 12, width: 1920, height: 1080, createdAt: new Date().toISOString() },
      { id: genId(), name: 'Street_Tracking.mp4', type: 'video', url: '', duration: 8, width: 1920, height: 1080, createdAt: new Date().toISOString() },
      { id: genId(), name: 'Architecture_CloseUp.mp4', type: 'video', url: '', duration: 6, width: 1920, height: 1080, createdAt: new Date().toISOString() },
      { id: genId(), name: 'Sunset_Timelapse.mp4', type: 'video', url: '', duration: 10, width: 3840, height: 2160, createdAt: new Date().toISOString() },
      { id: genId(), name: 'Ambient_Score.wav', type: 'audio', url: '', duration: 36, createdAt: new Date().toISOString() },
      { id: genId(), name: 'City_Atmosphere.wav', type: 'audio', url: '', duration: 20, createdAt: new Date().toISOString() },
    ];

    for (const asset of assets) {
      dispatch({ type: 'ADD_ASSET', asset });
    }

    // Create tracks
    const v1 = genId(), v2 = genId(), a1 = genId(), a2 = genId();

    const timeline = {
      id: genId(),
      name: 'Golden Hour Edit',
      tracks: [
        { id: v1, name: 'V1', kind: 'video', color: '#4a9fd6', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: v2, name: 'V2', kind: 'video', color: '#e67e22', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: a1, name: 'A1', kind: 'audio', color: '#5bbf5b', muted: false, solo: false, locked: false, visible: true, volume: 1 },
        { id: a2, name: 'A2', kind: 'audio', color: '#9b59b6', muted: false, solo: false, locked: false, visible: true, volume: 1 },
      ],
      clips: [
        // V1 — main video clips
        { id: genId(), assetId: assets[0].id, trackId: v1, name: 'Aerial_CityGoldenHour', startTime: 0, duration: 12, trimStart: 1, trimEnd: 1, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [] },
        { id: genId(), assetId: assets[1].id, trackId: v1, name: 'Street_Tracking', startTime: 10, duration: 8, trimStart: 0.5, trimEnd: 0, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [] },
        { id: genId(), assetId: assets[2].id, trackId: v1, name: 'Architecture_CloseUp', startTime: 17.5, duration: 6, trimStart: 0, trimEnd: 0.5, speed: 0.75, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [] },
        { id: genId(), assetId: assets[3].id, trackId: v1, name: 'Sunset_Timelapse', startTime: 25, duration: 10, trimStart: 2, trimEnd: 1, speed: 1, opacity: 1, volume: 1, flipH: false, flipV: false, keyframes: [] },
        // V2 — overlay clips
        { id: genId(), assetId: assets[3].id, trackId: v2, name: 'Sunset_Overlay', startTime: 5, duration: 10, trimStart: 3, trimEnd: 3, speed: 1, opacity: 0.4, volume: 0, flipH: false, flipV: false, keyframes: [{ time: 0, property: 'opacity', value: 0 }, { time: 2, property: 'opacity', value: 0.4 }] },
        // A1 — score
        { id: genId(), assetId: assets[4].id, trackId: a1, name: 'Ambient_Score', startTime: 0, duration: 36, trimStart: 0, trimEnd: 3, speed: 1, opacity: 1, volume: 0.8, flipH: false, flipV: false, keyframes: [{ time: 0, property: 'volume', value: 0 }, { time: 2, property: 'volume', value: 0.8 }] },
        // A2 — atmosphere
        { id: genId(), assetId: assets[5].id, trackId: a2, name: 'City_Atmosphere', startTime: 10, duration: 20, trimStart: 0, trimEnd: 2, speed: 1, opacity: 1, volume: 0.5, flipH: false, flipV: false, keyframes: [] },
      ],
      duration: 35,
      transitions: [
        { id: genId(), type: 'dissolve', duration: 1.5, clipAId: '', clipBId: '' },
      ],
      markers: [
        { id: genId(), time: 0, color: '#4a9fd6', label: 'Intro' },
        { id: genId(), time: 10, color: '#e67e22', label: 'Act 2' },
        { id: genId(), time: 25, color: '#e74c3c', label: 'Finale' },
      ],
    };

    dispatch({ type: 'ADD_TIMELINE', timeline });
  });

  console.log('  ✓ Timeline populated with demo clips');
}

async function main() {
  console.log('Launching CineGen...\n');

  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  const pmWindow = await waitForPMWindow(app);
  console.log('Project Manager window ready');
  await sleep(2000);

  // 1. Capture PM / Home view
  console.log('\nCapturing screenshots...');
  await takeScreenshot(pmWindow, '01-project-manager');

  // 2. Create a temporary project
  console.log('\n  Creating temp project...');
  const newProjectBtn = await pmWindow.$('button.pm-bottombar__btn:has-text("New Project")');
  if (!newProjectBtn) {
    console.log('  ⊘ Could not find New Project button');
    await app.close();
    return;
  }

  await newProjectBtn.click();
  await sleep(500);
  const input = await pmWindow.$('input.pm-create-inline__input');
  if (input) {
    await input.fill('Golden Hour City Film');
    await sleep(300);
    const createBtn = await pmWindow.$('button.pm-bottombar__btn--primary:has-text("Create")');
    if (createBtn) await createBtn.click();
  }

  console.log('  Waiting for workspace...');
  await sleep(4000);
  const mainWindow = await waitForMainWindow(app);

  if (!mainWindow) {
    console.log('  ⊘ Main workspace window did not appear');
    await app.close();
    return;
  }

  console.log('  Workspace ready\n');
  await sleep(3000);

  // 3. Switch to Spaces tab and populate nodes
  console.log('Populating Spaces canvas...');
  const spacesTab = await mainWindow.$('button.top-nav__tab:has-text("Spaces")');
  if (spacesTab) {
    await spacesTab.click();
    await sleep(2000);
    await populateSpacesCanvas(mainWindow);
    await sleep(1000);
    await takeScreenshot(mainWindow, '02-spaces');
  } else {
    console.log('  ⊘ Spaces tab not found');
  }

  // 4. Switch to Edit tab and populate timeline
  console.log('\nPopulating Edit timeline...');
  const editTab = await mainWindow.$('button.top-nav__tab:has-text("Edit")');
  if (editTab) {
    await editTab.click();
    await sleep(2000);
    await populateTimeline(mainWindow);
    await sleep(1500);
    await takeScreenshot(mainWindow, '03-edit');
  } else {
    console.log('  ⊘ Edit tab not found');
  }

  // 5. Capture remaining tabs
  const otherTabs = [
    { label: 'Elements', name: '04-elements' },
    { label: 'LLM', name: '05-llm' },
    { label: 'Export', name: '06-export' },
  ];

  for (const { label, name } of otherTabs) {
    const tab = await mainWindow.$(`button.top-nav__tab:has-text("${label}")`);
    if (tab) {
      await tab.click();
      await takeScreenshot(mainWindow, name);
    } else {
      console.log(`  ⊘ Tab "${label}" not found`);
    }
  }

  console.log(`\nDone! Screenshots saved to ./screenshots/`);
  await app.close();
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
