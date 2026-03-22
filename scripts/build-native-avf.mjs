import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const nativeDir = path.join(rootDir, 'native', 'avfoundation');
const outputPath = path.join(nativeDir, 'build', 'Release', 'cinegen_avfoundation.node');
const sourceFiles = [
  path.join(nativeDir, 'binding.gyp'),
  path.join(nativeDir, 'src', 'cinegen_avfoundation.mm'),
];

if (process.platform !== 'darwin') {
  console.log('[build-native-avf] skipping: macOS only');
  process.exit(0);
}

function getMTime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

const latestSourceMTime = Math.max(...sourceFiles.map(getMTime));
const outputMTime = getMTime(outputPath);
if (outputMTime > 0 && outputMTime >= latestSourceMTime) {
  console.log('[build-native-avf] up to date');
  process.exit(0);
}

const nodeGypBin = path.join(rootDir, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const result = spawnSync(process.execPath, [nodeGypBin, 'rebuild'], {
  cwd: nativeDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_build_from_source: 'true',
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
