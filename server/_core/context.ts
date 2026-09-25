import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  if (ENV.demoUserEnabled) {
    const now = new Date(0);
    return {
      req: opts.req,
      res: opts.res,
      user: {
        id: 0,
        openId: "local-demo-user",
        name: "Demonstração local",
        email: null,
        loginMethod: "local-demo",
        role: "user",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      },
    };
  }

  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
