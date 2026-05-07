import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const child = spawn(electronBinary, ['dist-electron/electron/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
