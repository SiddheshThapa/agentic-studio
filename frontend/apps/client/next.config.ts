import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Two levels up (frontend/), not __dirname: this app imports source from
    // ../../packages/core, and turbopack won't resolve outside its root.
    root: path.join(__dirname, "../.."),
  },
  // This repo lives under OneDrive's synced folder, and OneDrive's live sync
  // agent races every write under .next/ — not just Turbopack's persistent
  // cache but the plain dev build-manifest/chunk files too — deleting or
  // relocating them mid-write and crashing the server (ENOENT on files that
  // existed a moment earlier). `distDir` can't route around this: Next joins
  // it onto the project root internally, so it must stay relative — pointing
  // it at an absolute path produces a different, equally broken crash.
  // Don't turn .next into an NTFS junction pointing outside OneDrive either —
  // tried it: Turbopack's PostCSS transform runs as a Node subprocess that
  // resolves modules from the file's real path, and a junction target outside
  // this tree breaks that resolution chain back to node_modules entirely
  // ("Cannot find module '@tailwindcss/postcss'"), which is worse than the
  // original crash. No tooling-level fix found yet — the durable one is
  // excluding this project folder from OneDrive sync, or moving the repo
  // outside the synced tree. If dev crashes with "Persisting failed: Unable
  // to write SST file", just restart it; it's usually a one-off.
};

export default nextConfig;
