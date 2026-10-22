import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// client/ is its own app with its own tests and dependencies. Tests never
// write into the real artifacts/sources.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { OPENTAXRATE_DOWNLOAD_DIR: path.join(tmpdir(), "opentaxrate-test-artifacts") },
  },
});
