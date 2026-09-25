import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeProcess,
  defaultScenarioConfig,
  makeDemoLog,
  simulateScenario,
} from "../shared/processGraph";

const outputArgument = process.argv.indexOf("--output");
const output =
  outputArgument >= 0
    ? process.argv[outputArgument + 1]
    : ".artifacts/proof.json";
if (!output) throw new Error("Use --output <path>.");

const events = makeDemoLog(20_260_924, 120);
const analysis = analyzeProcess(events);
const simulation = simulateScenario(
  analysis,
  { ...defaultScenarioConfig(), replications: 100, seed: 42_019 },
  events
);
const proof = {
  schemaVersion: "1.0",
  dataset: {
    kind: "synthetic-control",
    sourceHash: analysis.sourceHash,
    cases: analysis.metrics.caseCount,
    events: analysis.metrics.eventCount,
  },
  engine: {
    discovery: analysis.model.algorithmVersion,
    simulation: simulation.engineVersion,
  },
  discovery: {
    activities: analysis.activities.length,
    transitions: analysis.edges.length,
    variants: analysis.variants.length,
    processTree: analysis.model.processTree,
    fallbacks: analysis.model.fallbackCount,
  },
  conformance: {
    trainCases: analysis.conformance.trainCases,
    validationCases: analysis.conformance.validationCases,
    fitness: analysis.conformance.fitness,
    precision: analysis.conformance.precision,
    generalization: analysis.conformance.generalization,
    deviationRate: analysis.conformance.deviationRate,
  },
  simulation: {
    replications: simulation.replications,
    seed: simulation.seed,
    baseline: simulation.baseline,
    scenario: simulation.scenario,
    validation: simulation.validation,
    warnings: simulation.warnings,
  },
  evidence: analysis.evidence,
};

const absolute = path.resolve(output);
await mkdir(path.dirname(absolute), { recursive: true });
await writeFile(absolute, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
process.stdout.write(`${absolute}\n`);
