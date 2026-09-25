import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

const request = {
  headers: {},
} as CreateExpressContextOptions["req"];
const response = {} as CreateExpressContextOptions["res"];

describe("local demo authentication", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("provides a deterministic demo user only in non-production mode", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_USER_ENABLED", "true");
    const { createContext } = await import("./_core/context");

    const context = await createContext({ req: request, res: response });

    expect(context.user).toMatchObject({
      openId: "local-demo-user",
      loginMethod: "local-demo",
      role: "user",
    });
    expect(context.user?.createdAt.toISOString()).toBe(
      "1970-01-01T00:00:00.000Z"
    );
  });

  it("ignores the bypass in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_USER_ENABLED", "true");
    const { createContext } = await import("./_core/context");

    const context = await createContext({ req: request, res: response });

    expect(context.user).toBeNull();
  });
});
