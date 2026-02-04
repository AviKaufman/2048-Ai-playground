# 2048 AI Playground

A modern 2048 web game with a fast AI autoplay mode, built with Next.js and designed to live as a subpage of `avi-kaufman.com` and deployed via Vercel.

## Highlights
- Smooth, responsive 2048 board UI with keyboard controls.
- AI autoplay powered by a high-performance 64-bit bitboard solver.
- Web Worker + WASM execution to keep the UI responsive.
- Best score saved locally.

## Tech Stack
- Next.js (App Router)
- TypeScript
- CSS Modules
- Web Worker + WebAssembly

## AI Solver
The AI is based on the fast 64-bit bitboard solver by Robert Xiao (nneonneo). The original C++ implementation lives in `2048-ai-master`, and the compiled WASM bundle is shipped in `public/ai2048.wasm` + `src/wasm/ai2048.js`.

## Credits
- Solver: Robert Xiao (nneonneo), `2048-ai` (MIT License). See `2048-ai-master/LICENSE`.
- Built with help from Codex.

## Local Development
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deployment
This site is intended to be hosted under `avi-kaufman.com` using Vercel.
