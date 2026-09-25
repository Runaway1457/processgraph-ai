import { describe, expect, it } from "vitest";
import {
  analyzeProcess,
  defaultScenarioConfig,
  makeDemoLog,
  parseCsvLog,
  parseEventLog,
  parseXesLog,
  simulateScenario,
  type ProcessEvent,
} from "../shared/processGraph";

const simpleLog: ProcessEvent[] = [
  {
    caseId: "A",
    activity: "Request",
    timestamp: Date.UTC(2026, 0, 1),
    resource: "Buyer 1",
  },
  {
    caseId: "A",
    activity: "Approve",
    timestamp: Date.UTC(2026, 0, 3),
    resource: "Manager 1",
  },
  {
    caseId: "A",
    activity: "Order",
    timestamp: Date.UTC(2026, 0, 5),
    resource: "Buyer 1",
  },
  {
    caseId: "B",
    activity: "Request",
    timestamp: Date.UTC(2026, 0, 2),
    resource: "Buyer 2",
  },
  {
    caseId: "B",
    activity: "Approve",
    timestamp: Date.UTC(2026, 0, 2, 12),
    resource: "Manager 1",
  },
  {
    caseId: "B",
    activity: "Order",
    timestamp: Date.UTC(2026, 0, 6),
    resource: "Buyer 2",
  },
  {
    caseId: "C",
    activity: "Request",
    timestamp: Date.UTC(2026, 0, 3),
    resource: "Buyer 3",
  },
  {
    caseId: "C",
    activity: "Revise",
    timestamp: Date.UTC(2026, 0, 4),
    resource: "Buyer 3",
  },
  {
    caseId: "C",
    activity: "Approve",
    timestamp: Date.UTC(2026, 0, 5),
    resource: "Manager 2",
  },
  {
    caseId: "C",
    activity: "Order",
    timestamp: Date.UTC(2026, 0, 8),
    resource: "Buyer 3",
  },
];

describe("processGraph event log parsing", () => {
  it("parses quoted comma-separated CSV and sorts timestamps", () => {
    const parsed = parseCsvLog(
      [
        "case_id,activity,timestamp,resource",
        'A,"Request, urgent",2026-01-02T00:00:00Z,"Buyer, North"',
        "A,Approve,2026-01-03T00:00:00Z,Manager",
      ].join("\n")
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].activity).toBe("Request, urgent");
    expect(parsed[0].resource).toBe("Buyer, North");
  });

  it("recognizes Brazilian semicolon CSV and common Portuguese headers", () => {
    const parsed = parseEventLog(
      [
        "id_caso;atividade;datahora;responsavel",
        "1;Solicitação criada;2026-01-01T00:00:00Z;Comprador",
        "1;Aprovação;2026-01-02T00:00:00Z;Gerente",
      ].join("\n")
    );
    expect(parsed.map(event => event.activity)).toEqual([
      "Solicitação criada",
      "Aprovação",
    ]);
  });

  it("parses XES trace identity, timestamps and resources", () => {
    const xes = `<?xml version="1.0"?><log><trace><string key="concept:name" value="OC-1"/><event><string key="concept:name" value="Pedido criado"/><date key="time:timestamp" value="2026-01-01T00:00:00.000Z"/><string key="org:resource" value="ERP"/></event><event><string key="concept:name" value="Aprovação"/><date key="time:timestamp" value="2026-01-02T00:00:00.000Z"/></event></trace></log>`;
    const parsed = parseXesLog(xes);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      caseId: "OC-1",
      activity: "Pedido criado",
      resource: "ERP",
    });
    expect(parsed[1].resource).toBe("Não informado");
  });

  it("rejects missing required CSV columns with a useful diagnostic", () => {
    expect(() => parseCsvLog("case_id,activity\nA,Request")).toThrow(
      "timestamp"
    );
  });
});

describe("processGraph deterministic discovery", () => {
  it("discovers directly-follows edges, exact variants, waits and deviation evidence", () => {
    const analysis = analyzeProcess(simpleLog);
    expect(analysis.metrics.caseCount).toBe(3);
    expect(analysis.metrics.eventCount).toBe(10);
    expect(
      analysis.edges.find(
        edge => edge.from === "Request" && edge.to === "Approve"
      )?.count
    ).toBe(2);
    expect(analysis.variants).toHaveLength(2);
    expect(analysis.variants[0]?.path).toEqual(["Request", "Approve", "Order"]);
    expect(analysis.evidence.some(fact => fact.id === "bottleneck")).toBe(true);
    expect(analysis.metrics.firstPassRate).toBe(1);
    expect(analysis.trend.length).toBeGreaterThan(0);
  });

  it("reproduces the seeded demo log exactly", () => {
    expect(makeDemoLog(771, 12)).toEqual(makeDemoLog(771, 12));
  });
});

describe("processGraph scenario simulation", () => {
  it("is deterministic for a fixed seed and configuration", () => {
    const analysis = analyzeProcess(simpleLog);
    const config = { ...defaultScenarioConfig(), replications: 12, seed: 9271 };
    expect(simulateScenario(analysis, config)).toEqual(
      simulateScenario(analysis, config)
    );
  });

  it("honors the replication limit while producing monotonic output intervals", () => {
    const analysis = analyzeProcess(simpleLog);
    const result = simulateScenario(analysis, {
      ...defaultScenarioConfig(),
      replications: 8,
    });
    expect(result.replications).toBe(8);
    expect(result.baseline.p05).toBeLessThanOrEqual(result.baseline.median);
    expect(result.baseline.median).toBeLessThanOrEqual(result.baseline.p95);
    expect(result.scenario.p05).toBeLessThanOrEqual(result.scenario.median);
    expect(result.scenario.median).toBeLessThanOrEqual(result.scenario.p95);
  });

  it("models increased demand as more arrivals over the same horizon", () => {
    const analysis = analyzeProcess(simpleLog);
    const baseline = simulateScenario(analysis, {
      ...defaultScenarioConfig(),
      replications: 4,
      volumeIncreasePct: 0,
    });
    const increased = simulateScenario(analysis, {
      ...defaultScenarioConfig(),
      replications: 4,
      volumeIncreasePct: 100,
    });
    expect(increased.casesPerReplication).toBe(
      baseline.casesPerReplication * 2
    );
    expect(increased.arrivalVolumePct).toBe(200);
  });
});
