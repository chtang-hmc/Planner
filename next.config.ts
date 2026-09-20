import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next dev` and `next build` share `.next` by default, so a build run while
   * the dev server is up overwrites the module graph underneath it. That is how
   * a working `/` came to throw "freeGaps is not a function" on 2026-09-19: the
   * code was fine, the running server's bundle was not.
   *
   * Building into a different directory costs nothing and removes the trap:
   *   NEXT_DIST_DIR=.next-build npm run build
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
