'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const root = __dirname;
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(dist, 'connector.cjs'),
});

execFileSync(process.execPath, ['--experimental-sea-config', path.join(root, 'sea-config.json')], { stdio: 'inherit' });
const executable = path.join(dist, 'FluidConnector.exe');
fs.copyFileSync(process.execPath, executable);

const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject,
  executable,
  'NODE_SEA_BLOB',
  path.join(dist, 'sea-prep.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit' });

// Node is normally a console executable. Switching the PE subsystem to GUI
// keeps the connector completely background-only when Windows starts it.
const image = fs.readFileSync(executable);
const peHeader = image.readUInt32LE(0x3c);
const optionalHeader = peHeader + 24;
image.writeUInt16LE(2, optionalHeader + 68);
fs.writeFileSync(executable, image);

console.log(`Built ${executable}`);
