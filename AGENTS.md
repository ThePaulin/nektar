# AGENTS.md

## Project Overview
- This repository is a Node.js app with a Vite + React + TypeScript frontend.
- The development server entrypoint is `server.ts`, which runs an Express server and Vite middleware.
- Frontend application code lives under `src/`.

## Standard Workflow
- Install dependencies with `npm install`.
- Create `.env.local` using `.env.example` as the reference.
- Start the app with `npm run dev`.
- Verify TypeScript correctness with `npm run lint`.
- Verify the production bundle with `npm run build`.

## Environment Notes
- `GEMINI_API_KEY` is required for Gemini API usage.
- `APP_URL` is documented in `.env.example`.

## Editing Rules
- Keep changes scoped to the task at hand.
- Do not revert or overwrite unrelated user changes in a dirty worktree.
- Do not invent project commands that are not defined in `package.json`.

## Verification Rule
- After any code change, always run `npm run build` and `npm run dev`.
- If either step fails, fix the issue before stopping.
