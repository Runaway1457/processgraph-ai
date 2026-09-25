import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("processGraph.investigate access control", () => {
  it("rejects anonymous requests before calling the investigation resolver", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.processGraph.investigate({
        question: "Quais etapas precisam de revisão?",
        facts: [
          {
            id: "leadtime",
            label: "Lead time mediano",
            value: "2 dias",
            detail: "Amostra local.",
          },
        ],
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
