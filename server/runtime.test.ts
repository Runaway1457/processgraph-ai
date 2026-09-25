import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("production runtime", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("registers the SPA fallback under Express 5", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    const { serveStatic } = await import("./_core/vite");

    expect(() => serveStatic(app)).not.toThrow();
  });
});
