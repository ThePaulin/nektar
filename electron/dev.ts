process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.ELECTRON_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';

await import('./main.js');
