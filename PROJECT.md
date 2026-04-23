# Design Overview

## Purpose

`Nektar` is a dense, timeline-first media editor built for fast clip assembly, recording, trimming, and export inside a single browser app. This document describes the current UI as implemented today and serves as the source of truth for how the editor is organized and how the major surfaces relate to one another.

## Product Shape

The app is centered around a pro-editor layout with three primary concerns:

1. Build and rearrange content on a multitrack timeline.
2. Preview the composite output as playback advances.
3. Inspect and adjust the selected clip or track without leaving the editor.

The interface is optimized for continuous editing rather than step-by-step wizards. Most actions are available in place, and the same session state is preserved so users can return to the project without rebuilding it from scratch.

## Main Surfaces

### Timeline

The timeline is the primary workspace and the strongest visual anchor in the app.

- It shows tracks, clips, selection state, playhead position, export range, and track ordering.
- It supports drag, trim, split, delete, duplicate, ripple delete, and reorder actions.
- It is frame-aware and snaps to nearby points for precise placement.
- It uses a fixed track header and scrollable content area so editing controls stay visible while the timeline extends horizontally.

The timeline is intentionally information-dense because it is the main editing surface for the product.

### Video Preview

The preview surface renders the composite result of visible clips at the current time.

- It is driven by the current timeline position and playback state.
- It supports layered composition across tracks.
- It applies clip transforms, crop, opacity, and track-level LUT processing when enabled.
- It is designed to stay stable even when media sources are missing or still loading, using a fallback rendering path.

This preview is not a detached player. It is the live feedback loop for timeline edits.

### Clip Properties Panel

The clip properties panel is the inspector for the selected clip.

- It exposes content editing for text and subtitle clips.
- It exposes typography controls for text-based clips.
- It exposes transform controls for visual clips, including position, rotation, scale, flip, opacity, and crop.
- It exposes filters such as brightness, saturation, and contrast.
- It exposes volume controls for audio-oriented clips.

The panel is intentionally scoped to the selected clip so that editing stays local and immediate.

### Track Actions

Track-level actions are handled directly from the timeline and adjacent controls.

- Tracks can be visible, locked, muted, armed, and reordered.
- Subtracks are used for camera and screen sources under a parent video track.
- Tracks can carry LUT configuration for color processing.
- Track selection drives where new imports and recordings land.

The track model is designed to support layered editor workflows without forcing users into separate modes or screens.

### Recorder and Audio Recorder

Recording is a first-class part of the interface.

- The recorder supports capture flows for camera, screen, and overlay sources.
- The audio recorder supports audio capture alongside the main editor flow.
- Recording respects the selected track, the current recording mode, and the track’s armed state.
- In insert mode, content is placed at the playhead; in append mode, it is added after the current content on the selected track.

The recording experience is integrated into the same timeline model as imported media, so captured media behaves like any other clip once it exists.

### Export Dialog

Export is handled in a dedicated dialog.

- The user chooses an export range from the timeline.
- The dialog supports output format selection based on browser capability.
- Export renders visible tracks within the chosen range.
- The export path uses the same compositing model as the preview, including LUT handling where applicable.

Export is treated as a final editing step, not a separate application state.

## Interaction Model

The editor follows a selection-and-inspect workflow:

- Select a clip to edit its properties.
- Select a track to control where new content is added.
- Move the playhead to preview another moment in the timeline.
- Use the export range to define the final rendered segment.
- Use undo and redo to recover from timeline edits and manipulations.

Mouse and touch interactions are both supported in the timeline and preview-driven workflows, which keeps the app usable across input styles.

## State And Persistence

The editor persists session state through IndexedDB.

- Clips and track metadata are stored locally.
- Binary media blobs are stored separately from clip metadata.
- Editor settings such as playhead position, export range, selected track, recording mode, timeline size, and density preferences are restored on reload.
- If prior session data exists, the app prompts the user to restore it before starting fresh.

This persistence model makes the app feel like a working project editor rather than a disposable demo.

## Development Server Role

The Node/Express server in `server.ts` serves two purposes:

- It provides Vite middleware during development.
- It exposes a proxy route for remote media fetching so browser-based playback and export can access external assets more reliably.

The server is intentionally lightweight. The core product still lives in the React frontend.

## Design Principles

- Keep the layout dense and task-oriented.
- Keep the timeline visible and central.
- Keep editing controls close to the content they affect.
- Preserve session state aggressively so work is recoverable.
- Favor immediate, in-place actions over multi-step dialogs where possible.
- Treat preview, recording, and export as parts of one editing loop.

## Implementation Notes

- [`src/App.tsx`](./src/App.tsx) owns the overall editor state and orchestration.
- [`src/components/Timeline.tsx`](./src/components/Timeline.tsx) owns timeline interaction and track editing behavior.
- [`src/components/VideoPreview.tsx`](./src/components/VideoPreview.tsx) owns compositing and preview rendering.
- [`src/components/ClipPropertiesPanel.tsx`](./src/components/ClipPropertiesPanel.tsx) owns the selected-clip inspector.
- [`src/components/ExportDialog.tsx`](./src/components/ExportDialog.tsx) owns export rendering and format selection.
- [`src/services/db.ts`](./src/services/db.ts) owns local persistence and restore behavior.
- [`server.ts`](./server.ts) owns dev-server bootstrapping and the proxy route.

## Summary

The current design is intentionally editor-like: compact, persistent, and centered on the timeline. Every major surface supports the same project model, so users can import, record, inspect, preview, and export without switching contexts.
