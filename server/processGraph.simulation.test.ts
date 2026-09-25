import { describe, expect, it } from "vitest";
import {
  analyzeProcess,
  defaultScenarioConfig,
  makeDemoLog,
  simulateScenario,
  type ProcessEvent,
} from "../shared/processGraph";

const day = 86_400_000;

function calibratedLog(caseCount = 24): ProcessEvent[] {
  const result: ProcessEvent[] = [];
  for (let index = 0; index < caseCount; index += 1) {
    const start = Date.UTC(2026, 0, 1) + index * day;
    result.push(
      {
        caseId: `C-${index}`,
        activity: "Create",
        timestamp: start,
        resource: `Requester-${index % 4}`,
      },
      {
        caseId: `C-${index}`,
        activity: "Approve",
        timestamp: start + (0.8 + (index % 3) * 0.1) * day,
        resource: `Manager-${index % 6}`,
      },
      {
        caseId: `C-${index}`,
        activity: "Pay",
        timestamp: start + (1.8 + (index % 3) * 0.1) * day,
        resource: `Finance-${index % 8}`,
      }
    );
  }
  return result;
}

describe("calibrated discrete-event simulation", () => {
  it("is deterministic with fixed seed, log and configuration", () => {
    const events = calibratedLog();
    const analysis = analyzeProcess(events);
    const config = { ...defaultScenarioConfig(), replications: 30, seed: 771 };
    expect(simulateScenario(analysis, config, events)).toEqual(
      simulateScenario(analysis, config, events)
    );
  });

  it("computes uncertainty across replication medians, not pooled cases", () => {
    const events = calibratedLog();
    const result = simulateScenario(
      analyzeProcess(events),
      { ...defaultScenarioConfig(), replications: 40 },
      events
    );
    expect(result.confidenceLevel).toBe(0.95);
    expect(result.baseline.lower).toBeLessThanOrEqual(result.baseline.median);
    expect(result.baseline.median).toBeLessThanOrEqual(result.baseline.upper);
    expect(result.scenario.lower).toBeLessThanOrEqual(result.scenario.median);
    expect(result.scenario.median).toBeLessThanOrEqual(result.scenario.upper);
  });

  it("fits every observed transition and exposes goodness-of-fit diagnostics", () => {
    const events = calibratedLog(36);
    const result = simulateScenario(
      analyzeProcess(events),
      { ...defaultScenarioConfig(), replications: 10 },
      events
    );
    const fits = Object.values(result.fittedDistributions);
    expect(fits.length).toBe(2);
    expect(fits.every(fit => fit.sampleCount > 0)).toBe(true);
    expect(
      fits.every(
        fit => Number.isFinite(fit.ksStatistic) && Number.isFinite(fit.bic)
      )
    ).toBe(true);
  });

  it("increased volume changes arrivals over a common model rather than renaming the horizon", () => {
    const events = calibratedLog();
    const analysis = analyzeProcess(events);
    const baseline = simulateScenario(
      analysis,
      { ...defaultScenarioConfig(), replications: 12, volumeIncreasePct: 0 },
      events
    );
    const doubled = simulateScenario(
      analysis,
      { ...defaultScenarioConfig(), replications: 12, volumeIncreasePct: 100 },
      events
    );
    expect(doubled.scenarioCasesPerReplication).toBe(
      baseline.baselineCasesPerReplication * 2
    );
    expect(doubled.arrivalRatePerDay).toBe(baseline.arrivalRatePerDay);
    expect(doubled.arrivalVolumePct).toBe(200);
  });

  it("records historical-validation status and never silently labels a failed model calibrated", () => {
    const events = calibratedLog();
    const result = simulateScenario(
      analyzeProcess(events),
      {
        ...defaultScenarioConfig(),
        replications: 20,
        validationTolerancePct: 0.0001,
      },
      events
    );
    expect(["passed", "failed"]).toContain(result.validation.status);
    if (result.validation.status === "failed") {
      expect(
        result.warnings.some(warning => warning.includes("fora da tolerância"))
      ).toBe(true);
    }
  });

  it("honors the hard replication ceiling", () => {
    const events = calibratedLog(6);
    const result = simulateScenario(
      analyzeProcess(events),
      { ...defaultScenarioConfig(), replications: 50_000 },
      events
    );
    expect(result.replications).toBe(1_000);
  }, 20_000);

  it("keeps synthetic demo output explicitly diagnosable", () => {
    const events = makeDemoLog(2026, 40);
    const result = simulateScenario(
      analyzeProcess(events),
      { ...defaultScenarioConfig(), replications: 8 },
      events
    );
    expect(result.engineVersion).toBe("2.0.0");
    expect(
      result.warnings.some(warning =>
        warning.includes("Timestamps de conclusão")
      )
    ).toBe(true);
    expect(result.validation.observedMedianDays).toBeGreaterThan(0);
  });
});
