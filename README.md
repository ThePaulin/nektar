# Nektar

A dense, timeline-first browser-based video editor for fast clip assembly, recording, trimming, and export.

## Features

- **Multitrack Timeline** - Drag, trim, split, delete, duplicate, and reorder clips across multiple tracks
- **Video Recording** - Capture from camera, screen, or overlay sources
- **Audio Recording** - Separate audio capture alongside the main editor
- **Clip Properties Panel** - Adjust transforms, filters, brightness, saturation, opacity, and crop
- **Text & Subtitles** - Create and style text overlays with typography controls
- **Track LUT Processing** - Apply color grading via lookup tables
- **WebGL/WebGPU Rendering** - Hardware-accelerated preview and export
- **Session Persistence** - IndexedDB stores projects locally for seamless recovery
- **Export** - Render to MP4 or WebM with configurable quality

## Tech Stack

React 19, TypeScript, Vite, Express, Tailwind CSS

## Prerequisites

- Node.js
- Modern browser with WebGPU support (Chrome/Edge recommended)

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Desktop Packaging

Electron is already wired for local desktop development and can now be packaged with `electron-builder`.

```bash
npm run desktop:dev
npm run desktop:pack
npm run desktop:dist
```

- `npm run desktop:dev` builds the renderer and Electron processes, then launches the app in Electron against the local renderer URL.
- `npm run desktop:pack` downloads the pinned FFmpeg binaries into `resources/ffmpeg/`, then creates an unpacked app bundle in `release/`.
- `npm run desktop:dist` creates installable artifacts for the current platform with `electron-builder`.
- Desktop icons are sourced from `build/icon.icns`, `build/icon.ico`, and `build/icon.png`.
- Desktop packaging repacks the staged app into `app.asar` after Electron Builder finishes staging, which avoids the built-in archive-integrity failure we hit in this environment while still producing an archived app bundle.
- Override the bundled FFmpeg release tag with `NEKTAR_FFMPEG_TAG=<tag> npm run desktop:pack` if you need to pin a different `eugeneware/ffmpeg-static` release.

Packaged Electron builds load the Vite output from `dist/` directly and do not depend on the Express dev server at runtime.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run desktop:build` | Build renderer plus Electron main/preload code |
| `npm run desktop:pack` | Create an unpacked Electron app |
| `npm run desktop:dist` | Create installable Electron artifacts |
| `npm run lint` | TypeScript type checking |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run Playwright e2e tests |
| `npm run test:all` | Run all tests |

## Project Structure

```
src/
  components/     # UI components (Timeline, VideoPreview, ExportDialog, etc.)
  lib/            # Core logic (editor-operations, lut, export, webgl/webgpu)
  services/       # Database persistence (db.ts)

tests/
  components/     # Component tests
  e2e/            # Playwright e2e tests
  unit/           # Unit tests

server.ts         # Express dev server with media proxy
```

## Further Reading

- [Design System](./DESIGN.md) - Visual theme, color palette, typography
- [Project Overview](./PROJECT.md) - Architecture and implementation details
