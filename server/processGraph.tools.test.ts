import { describe, expect, it } from "vitest";
import {
  executeInvestigationTool,
  parseToolCall,
  type InvestigationSnapshot,
} from "./processGraph.tools";

const distribution = { count: 20, mean: 3, median: 2, p90: 6, p95: 7, iqr: 2 };
const snapshot: InvestigationSnapshot = {
  analysisId: "analysis:test",
  sourceHash: "12345678abcdef",
  facts: [
    {
      id: "lead-time",
      kind: "metric",
      label: "Lead",
      value: "2 dias",
      detail: "Mediana observada.",
      sourcePath: "metrics.medianLeadDays",
    },
  ],
  edges: [
    {
      id: "edge:a",
      from: "Criar",
      to: "Aprovar",
      count: 20,
      waitDays: distribution,
    },
    {
      id: "edge:b",
      from: "Aprovar",
      to: "Pagar",
      count: 18,
      waitDays: { ...distribution, median: 5, p90: 9, p95: 10 },
    },
  ],
  variants: [
    {
      id: "variant:a",
      path: ["Criar", "Aprovar", "Pagar"],
      count: 16,
      share: 0.8,
      leadDays: distribution,
      impactVsMedianDays: -1,
    },
    {
      id: "variant:b",
      path: ["Criar", "Revisar", "Aprovar", "Pagar"],
      count: 4,
      share: 0.2,
      leadDays: { ...distribution, median: 7 },
      impactVsMedianDays: 4,
    },
  ],
};

describe("restricted investigation tools", () => {
  it("accepts only a declared tool with strict JSON arguments", () => {
    expect(parseToolCall("rank_bottlenecks", '{"limit":2}')).toEqual({
      name: "rank_bottlenecks",
      arguments: { limit: 2 },
    });
    expect(() => parseToolCall("run_sql", '{"query":"drop table"}')).toThrow();
    expect(() =>
      parseToolCall("rank_bottlenecks", '{"limit":2,"query":"all"}')
    ).toThrow();
  });

  it("rejects invalid JSON and limits before execution", () => {
    expect(() => parseToolCall("rank_bottlenecks", "not-json")).toThrow(
      "JSON válido"
    );
    expect(() => parseToolCall("rank_bottlenecks", '{"limit":99}')).toThrow();
  });

  it("cannot inspect a transition outside the authorized catalog", () => {
    const call = parseToolCall(
      "inspect_transition_distribution",
      '{"edgeId":"edge:missing"}'
    );
    expect(() => executeInvestigationTool(call, snapshot)).toThrow(
      "fora do escopo"
    );
  });

  it("returns values only from deterministic snapshot fields", () => {
    const call = parseToolCall(
      "inspect_transition_distribution",
      '{"edgeId":"edge:b"}'
    );
    const [fact] = executeInvestigationTool(call, snapshot);
    expect(fact.sourcePath).toBe("edges.edge:b.waitDays");
    expect(fact.value).toContain("5 dias");
    expect(fact.detail).toContain("9 dias");
  });

  it("compares two existing variants and rejects self-comparison", () => {
    const facts = executeInvestigationTool(
      parseToolCall(
        "compare_variants",
        '{"leftId":"variant:a","rightId":"variant:b"}'
      ),
      snapshot
    );
    expect(facts).toHaveLength(2);
    expect(facts.map(fact => fact.sourcePath)).toEqual([
      "variants.variant:a",
      "variants.variant:b",
    ]);
    expect(() =>
      executeInvestigationTool(
        parseToolCall(
          "compare_variants",
          '{"leftId":"variant:a","rightId":"variant:a"}'
        ),
        snapshot
      )
    ).toThrow("distintas");
  });

  it("ranks bottlenecks by median with deterministic tie-breaking", () => {
    const facts = executeInvestigationTool(
      parseToolCall("rank_bottlenecks", '{"limit":1}'),
      snapshot
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].label).toBe("Aprovar → Pagar");
  });
});
