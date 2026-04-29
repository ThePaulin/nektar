<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Nektar

A dense, timeline-first media editor built for fast clip assembly, recording, trimming, and export in the browser.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 6
- **Styling**: Tailwind CSS 4
- **Server**: Express (dev server with Vite middleware)
- **Persistence**: IndexedDB (better-sqlite3 for server-side)
- **Rendering**: WebGPU for LUT processing, WebM/MP4 muxer for export
- **Testing**: Vitest + Playwright

## Features

- **Multitrack Timeline** — Drag, trim, split, delete, duplicate, and reorder clips with frame-accurate snapping
- **Video Preview** — Real-time composite playback with layered composition, transforms, crop, opacity, and LUT processing
- **Clip Properties Panel** — Editor for transform, filters (brightness, saturation, contrast), crop, opacity, volume, and text/subtitles
- **Recording** — Camera, screen, and overlay capture with audio recording support
- **Export** — Export selection to MP4 or WebM with the same compositing model as preview
- **Session Persistence** — Editor state restored on reload via IndexedDB

## Prerequisites

- Node.js 18+

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env.local` file based on `.env.example`:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | API key for Gemini AI features |
| `APP_URL` | No | Self-referential URL for OAuth callbacks |

## Running

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Type check |
| `npm run test` | Unit tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run test:e2e` | End-to-end tests |
| `npm run test:all` | Run all tests |
| `npm run clean` | Remove build output |

## Project Structure

```
├── server.ts           # Express dev server
├── src/
│   ├── components/     # React components (Timeline, VideoPreview, etc.)
│   ├── lib/           # Utilities (editor-operations, LUT processing)
│   ├── services/      # IndexedDB persistence
│   ├── App.tsx        # Main app orchestration
│   └── main.tsx       # Entry point
├── tests/
│   ├── unit/          # Vitest unit tests
│   ├── e2e/           # Playwright e2e tests
│   └── components/    # Component tests
└── dist/              # Production build output
```