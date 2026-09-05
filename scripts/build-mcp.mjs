import { build } from 'esbuild';

// A standalone script can run with CineGen's bundled Electron/Node runtime.
// No source checkout, npm install, or external Node executable is needed.
await build({
  entryPoints: ['mcp/cinegen-mcp.mjs'],
  outfile: 'dist-electron/cinegen-mcp.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
});
console.log('[build-mcp] Standalone Claude MCP server ready');
