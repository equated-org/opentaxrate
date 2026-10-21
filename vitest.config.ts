import { defineConfig } from "vitest/config";

// landing/ is its own app with its own tests and dependencies.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
