import { describe, expect, it } from "vitest";
import {
  analyzeProcess,
  buildTraces,
  discoverProcessModel,
  parseCsvLogDetailed,
  parseXesLogDetailed,
  stableHash,
  summarizeDistribution,
  type ProcessEvent,
} from "../shared/processGraph";

const day = 86_400_000;

function trace(
  caseId: string,
  path: string[],
  waits: number[] = []
): ProcessEvent[] {
  let timestamp = Date.UTC(2026, 0, 1);
  return path.map((activity, index) => {
    const event = {
      caseId,
      activity,
      timestamp,
      resource: `${activity}-owner`,
      lifecycle: "complete" as const,
    };
    timestamp += (waits[index] ?? 1) * day;
    return event;
  });
}

describe("event-log quality contract", () => {
  it("retains free attributes and reports invalid, duplicate and missing-resource rows", () => {
    const parsed = parseCsvLogDetailed(
      [
        "case_id;activity;timestamp;resource;empresa;valor",
        "A;Criar;2026-01-01T00:00:00Z;Ana;BR01;1200,50",
        "A;Criar;2026-01-01T00:00:00Z;Ana;BR01;1200,50",
        "A;Aprovar;2026-01-03T00:00:00Z;;BR01;1200,50",
        "B;Criar;data-ruim;Bia;BR02;40",
      ].join("\n")
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].attributes).toMatchObject({
      empresa: "BR01",
      valor: 1200.5,
    });
    expect(parsed.quality.rejectedRows).toBe(1);
    expect(parsed.quality.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_event",
        "invalid_timestamp",
        "missing_resource",
      ])
    );
    expect(parsed.source.hashAlgorithm).toBe("fnv1a64");
  });

  it("rejects XML entity declarations before parsing XES", () => {
    expect(() =>
      parseXesLogDetailed(
        '<!DOCTYPE log [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><log/>'
      )
    ).toThrow("não permitidas");
  });

  it("reorders out-of-order input while preserving complete traces", () => {
    const parsed = parseCsvLogDetailed(
      [
        "case_id,activity,timestamp",
        "A,Aprovar,2026-01-03T00:00:00Z",
        "A,Criar,2026-01-01T00:00:00Z",
      ].join("\n")
    );
    expect(parsed.events.map(event => event.activity)).toEqual([
      "Criar",
      "Aprovar",
    ]);
    expect(
      parsed.quality.issues.some(issue => issue.code === "out_of_order_event")
    ).toBe(true);
  });
});

describe("cut-based process discovery", () => {
  it("recovers a planted sequence", () => {
    const traces = buildTraces([
      ...trace("A", ["Create", "Approve", "Pay"]),
      ...trace("B", ["Create", "Approve", "Pay"]),
      ...trace("C", ["Create", "Approve", "Pay"]),
    ]);
    const model = discoverProcessModel(traces);
    expect(model.processTree.operator).toBe("sequence");
    expect(model.startActivities).toEqual(["Create"]);
    expect(model.endActivities).toEqual(["Pay"]);
    expect(model.fallbackCount).toBe(0);
  });

  it("recovers an exclusive branch from disconnected alternatives", () => {
    const model = discoverProcessModel(
      buildTraces([
        ...trace("A", ["Start", "Manual review", "End"]),
        ...trace("B", ["Start", "Automatic review", "End"]),
      ])
    );
    expect(JSON.stringify(model.processTree)).toContain("xor");
    expect(model.startActivities).toEqual(["Start"]);
  });

  it("keeps discovery deterministic byte for byte", () => {
    const traces = buildTraces([
      ...trace("A", ["A", "B", "C"]),
      ...trace("B", ["A", "D", "C"]),
    ]);
    expect(JSON.stringify(discoverProcessModel(traces))).toBe(
      JSON.stringify(discoverProcessModel(traces))
    );
  });
});

describe("conformance, bottlenecks and variants", () => {
  it("finds the planted waiting-time bottleneck using the median and distribution", () => {
    const events = [
      ...trace("A", ["Create", "Approve", "Pay"], [1, 8]),
      ...trace("B", ["Create", "Approve", "Pay"], [1, 9]),
      ...trace("C", ["Create", "Approve", "Pay"], [1, 10]),
      ...trace("D", ["Create", "Approve", "Pay"], [1, 11]),
      ...trace("E", ["Create", "Approve", "Pay"], [1, 12]),
    ];
    const analysis = analyzeProcess(events);
    const bottleneck = [...analysis.edges].sort(
      (left, right) => right.waitDays.median - left.waitDays.median
    )[0];
    expect(`${bottleneck.from}->${bottleneck.to}`).toBe("Approve->Pay");
    expect(bottleneck.waitDays.median).toBe(10);
    expect(bottleneck.waitDays.p90).toBeGreaterThan(bottleneck.waitDays.median);
    expect(
      analysis.evidence.find(fact => fact.id === "bottleneck")?.sourcePath
    ).toContain(bottleneck.id);
  });

  it("ranks variants by frequency and exposes lead-time impact", () => {
    const events = [
      ...trace("A", ["A", "B", "C"], [1, 1]),
      ...trace("B", ["A", "B", "C"], [1, 1]),
      ...trace("C", ["A", "B", "C"], [1, 1]),
      ...trace("D", ["A", "Review", "B", "C"], [4, 4, 4]),
    ];
    const analysis = analyzeProcess(events);
    expect(analysis.variants[0].count).toBe(3);
    expect(
      analysis.variants.find(variant => variant.path.includes("Review"))
        ?.impactVsMedianDays
    ).toBeGreaterThan(0);
  });

  it("reports non-zero alignment cost for a planted deviation in holdout", () => {
    const normalIds = Array.from(
      { length: 16 },
      (_, index) => `normal-${index}`
    );
    const candidateIds = Array.from(
      { length: 200 },
      (_, index) => `deviation-${index}`
    );
    const validationId = candidateIds.find(
      caseId => Number.parseInt(stableHash(caseId).slice(0, 8), 16) % 5 === 0
    )!;
    const events = [
      ...normalIds.flatMap(caseId => trace(caseId, ["A", "B", "C"])),
      ...trace(validationId, ["A", "Unexpected", "C"]),
    ];
    const analysis = analyzeProcess(events);
    const alignment = analysis.conformance.alignments.find(
      item => item.caseId === validationId
    );
    expect(alignment?.isDeviation).toBe(true);
    expect(alignment?.cost).toBeGreaterThan(0);
    expect(alignment?.moves.some(move => move.kind !== "sync")).toBe(true);
  });

  it("uses a deterministic holdout instead of scoring only the training log", () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      trace(`case-${index}`, ["A", index % 5 ? "B" : "X", "C"])
    ).flat();
    const analysis = analyzeProcess(events);
    expect(
      analysis.conformance.trainCases + analysis.conformance.validationCases
    ).toBe(30);
    expect(analysis.conformance.validationCases).toBeGreaterThan(0);
    expect(analysis.conformance.fitness).toBeGreaterThanOrEqual(0);
    expect(analysis.conformance.fitness).toBeLessThanOrEqual(1);
  });

  it("summarizes tails without hiding dispersion behind the mean", () => {
    const summary = summarizeDistribution([1, 1, 1, 1, 20]);
    expect(summary.median).toBe(1);
    expect(summary.mean).toBeGreaterThan(summary.median);
    expect(summary.maximum).toBe(20);
    expect(summary.p95).toBeGreaterThan(1);
  });
});
