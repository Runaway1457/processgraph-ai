import { buildTraces } from "./discovery";
import {
  clamp,
  createSeededRandom,
  kolmogorovSmirnov,
  mean,
  normalCdf,
  quantile,
  variance,
} from "./statistics";
import type {
  FittedDistribution,
  ProcessAnalysis,
  ProcessEvent,
  ScenarioConfig,
  SimulationResult,
  VariantStat,
} from "./types";

const DAY_MS = 86_400_000;
const ENGINE_VERSION = "2.0.0";

type DistributionModel = FittedDistribution & {
  sample: (random: () => number) => number;
};
type SimulatedCase = { id: number; route: string[]; stage: number };
type QueueEvent = {
  time: number;
  kind: "arrival" | "complete";
  processCase: SimulatedCase;
};

function exponentialSample(random: () => number, meanDays: number): number {
  return -Math.log(Math.max(1e-12, 1 - random())) * meanDays;
}

function normalSample(random: () => number): number {
  const first = Math.max(1e-12, random());
  const second = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function fitDistribution(samples: readonly number[]): DistributionModel {
  const positive = samples.filter(value => Number.isFinite(value) && value > 0);
  if (
    positive.length < 4 ||
    new Set(positive.map(value => value.toFixed(8))).size === 1
  ) {
    const constant = Math.max(1 / 1_440, mean(positive) || 0.25);
    return {
      family: "constant",
      sampleCount: positive.length,
      parameters: { value: constant },
      ksStatistic: 0,
      bic: 0,
      warning:
        "Amostra insuficiente para comparar famílias; distribuição constante usada.",
      sample: () => constant,
    };
  }
  const average = Math.max(1e-9, mean(positive));
  const exponentialLogLikelihood = positive.reduce(
    (sum, value) => sum + Math.log(1 / average) - value / average,
    0
  );
  const exponentialBic =
    Math.log(positive.length) - 2 * exponentialLogLikelihood;
  const exponentialKs = kolmogorovSmirnov(
    positive,
    value => 1 - Math.exp(-value / average)
  );

  const logged = positive.map(Math.log);
  const mu = mean(logged);
  const sigma = Math.max(1e-6, Math.sqrt(variance(logged)));
  const lognormalLogLikelihood = positive.reduce(
    (sum, value) =>
      sum -
      Math.log(value * sigma * Math.sqrt(2 * Math.PI)) -
      (Math.log(value) - mu) ** 2 / (2 * sigma ** 2),
    0
  );
  const lognormalBic =
    2 * Math.log(positive.length) - 2 * lognormalLogLikelihood;
  const lognormalKs = kolmogorovSmirnov(positive, value =>
    normalCdf((Math.log(value) - mu) / sigma)
  );

  if (lognormalBic <= exponentialBic) {
    return {
      family: "lognormal",
      sampleCount: positive.length,
      parameters: { mu, sigma },
      ksStatistic: lognormalKs,
      bic: lognormalBic,
      warning:
        lognormalKs > 0.2
          ? "A aderência é fraca (KS > 0,20); valide com mais dados."
          : undefined,
      sample: random => Math.exp(mu + sigma * normalSample(random)),
    };
  }
  return {
    family: "exponential",
    sampleCount: positive.length,
    parameters: { mean: average },
    ksStatistic: exponentialKs,
    bic: exponentialBic,
    warning:
      exponentialKs > 0.2
        ? "A aderência é fraca (KS > 0,20); valide com mais dados."
        : undefined,
    sample: random => exponentialSample(random, average),
  };
}

function pushEvent(heap: QueueEvent[], value: QueueEvent): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent].time <= value.time) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = value;
}

function popEvent(heap: QueueEvent[]): QueueEvent | undefined {
  if (!heap.length) return undefined;
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child =
        right < heap.length && heap[right].time < heap[left].time
          ? right
          : left;
      if (heap[child].time >= last.time) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return first;
}

function calendarMultiplier(config: ScenarioConfig): number {
  const workingDays = Math.max(
    1,
    new Set(config.calendar.workingWeekdays).size
  );
  const workingHours = clamp(
    config.calendar.workdayEndHour - config.calendar.workdayStartHour,
    1,
    24
  );
  return (7 / workingDays) * (24 / workingHours);
}

function selectVariant(
  random: () => number,
  variants: readonly VariantStat[]
): string[] {
  const roll = random();
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.share;
    if (roll <= cumulative) return [...variant.path];
  }
  return [...(variants.at(-1)?.path ?? [])];
}

function simulateReplication(args: {
  variants: readonly VariantStat[];
  distributions: Map<string, DistributionModel>;
  capacities: Map<string, number>;
  caseCount: number;
  arrivalRatePerDay: number;
  seed: number;
  config: ScenarioConfig;
  scenario: boolean;
}): number[] {
  const random = createSeededRandom(args.seed);
  const heap: QueueEvent[] = [];
  const queues = new Map<string, SimulatedCase[]>();
  const busy = new Map<string, number>();
  const arrivals = new Map<number, number>();
  const finished: number[] = [];
  const multiplier = calendarMultiplier(args.config);
  const approvalPattern = /aprova/i;
  let arrivalTime = 0;
  for (let caseId = 0; caseId < args.caseCount; caseId += 1) {
    arrivalTime += exponentialSample(
      random,
      1 / Math.max(1e-6, args.arrivalRatePerDay)
    );
    let route = selectVariant(random, args.variants);
    if (
      args.scenario &&
      args.config.approvalPolicy === "skip_manager_below_threshold"
    ) {
      route = route.filter(
        (activity, index) =>
          !(approvalPattern.test(activity) && index > 0 && random() < 0.35)
      );
    }
    if (!route.length) continue;
    const processCase = { id: caseId, route, stage: 0 };
    arrivals.set(caseId, arrivalTime);
    pushEvent(heap, { time: arrivalTime, kind: "arrival", processCase });
  }
  const startJobs = (activity: string, now: number) => {
    const queue = queues.get(activity) ?? [];
    const capacity = Math.max(1, args.capacities.get(activity) ?? 1);
    while ((busy.get(activity) ?? 0) < capacity && queue.length) {
      const processCase = queue.shift()!;
      busy.set(activity, (busy.get(activity) ?? 0) + 1);
      const nextActivity = processCase.route[processCase.stage + 1];
      const key = nextActivity
        ? `${activity}\u001f${nextActivity}`
        : `${activity}\u001f__end__`;
      const distribution =
        args.distributions.get(key) ??
        args.distributions.get(`${activity}\u001f*`);
      let duration = distribution?.sample(random) ?? 0.05;
      if (args.scenario && approvalPattern.test(activity))
        duration *= clamp(args.config.approvalSpeed, 0.25, 2);
      if (args.scenario && args.config.automationActivity === activity)
        duration *= 0.2;
      pushEvent(heap, {
        time: now + Math.max(1 / 1_440, duration * multiplier),
        kind: "complete",
        processCase,
      });
    }
    queues.set(activity, queue);
  };
  while (heap.length) {
    const event = popEvent(heap)!;
    const activity = event.processCase.route[event.processCase.stage];
    if (!activity) continue;
    if (event.kind === "arrival") {
      const queue = queues.get(activity) ?? [];
      queue.push(event.processCase);
      queues.set(activity, queue);
      startJobs(activity, event.time);
      continue;
    }
    busy.set(activity, Math.max(0, (busy.get(activity) ?? 1) - 1));
    startJobs(activity, event.time);
    event.processCase.stage += 1;
    const next = event.processCase.route[event.processCase.stage];
    if (!next) {
      finished.push(
        Math.max(
          0,
          event.time - (arrivals.get(event.processCase.id) ?? event.time)
        )
      );
    } else {
      const queue = queues.get(next) ?? [];
      queue.push(event.processCase);
      queues.set(next, queue);
      startJobs(next, event.time);
    }
  }
  return finished;
}

function extractSamples(
  events: readonly ProcessEvent[]
): Map<string, number[]> {
  const samples = new Map<string, number[]>();
  for (const trace of buildTraces(events)) {
    for (let index = 0; index < trace.events.length - 1; index += 1) {
      const current = trace.events[index];
      const next = trace.events[index + 1];
      const value = Math.max(
        1 / 1_440,
        (next.timestamp - current.timestamp) / DAY_MS
      );
      const exact = `${current.activity}\u001f${next.activity}`;
      const wildcard = `${current.activity}\u001f*`;
      samples.set(exact, [...(samples.get(exact) ?? []), value]);
      samples.set(wildcard, [...(samples.get(wildcard) ?? []), value]);
    }
  }
  return samples;
}

function estimateArrivalRate(
  events: readonly ProcessEvent[],
  caseCount: number
): number {
  const starts = buildTraces(events)
    .map(trace => trace.events[0]?.timestamp ?? 0)
    .sort((left, right) => left - right);
  if (starts.length < 2) return Math.max(0.1, caseCount / 90);
  const horizon = Math.max(
    1,
    ((starts.at(-1) ?? 0) - (starts[0] ?? 0)) / DAY_MS
  );
  return starts.length / horizon;
}

export function simulateScenario(
  analysis: ProcessAnalysis,
  config: ScenarioConfig,
  events: readonly ProcessEvent[] = []
): SimulationResult {
  if (
    !analysis.variants.length ||
    analysis.variants.every(variant => variant.path.length < 2)
  )
    throw new Error(
      "O cenário exige ao menos uma variante com duas atividades."
    );
  const replications = Math.round(
    clamp(config.replications || 1_000, 1, 1_000)
  );
  const samples = extractSamples(events);
  const distributions = new Map<string, DistributionModel>();
  const warnings = new Set<string>();
  if (!events.length)
    warnings.add(
      "Sem eventos brutos: os ajustes usam resumos e a validação histórica é apenas indicativa."
    );
  for (const edge of analysis.edges) {
    const key = `${edge.from}\u001f${edge.to}`;
    const raw =
      samples.get(key) ??
      [
        edge.waitDays.p25,
        edge.waitDays.median,
        edge.waitDays.p75,
        edge.waitDays.p90,
      ].filter(value => value > 0);
    const fitted = fitDistribution(raw);
    distributions.set(key, fitted);
    if (fitted.warning)
      warnings.add(`${edge.from} → ${edge.to}: ${fitted.warning}`);
  }
  for (const activity of analysis.activities) {
    const key = `${activity.activity}\u001f*`;
    if (!distributions.has(key))
      distributions.set(
        key,
        fitDistribution(samples.get(key) ?? [activity.waitDays.median || 0.25])
      );
  }
  const capacities = new Map(
    analysis.activities.map(activity => [
      activity.activity,
      Math.max(1, activity.resources.length || 1),
    ])
  );
  if (config.resourceLoss) {
    const bottleneck = [...analysis.activities].sort(
      (left, right) => right.waitDays.median - left.waitDays.median
    )[0]?.activity;
    if (bottleneck)
      capacities.set(
        bottleneck,
        Math.max(1, (capacities.get(bottleneck) ?? 1) - 1)
      );
  }
  const baselineCapacities = new Map(
    analysis.activities.map(activity => [
      activity.activity,
      Math.max(1, activity.resources.length || 1),
    ])
  );
  const baselineCaseCount = Math.max(1, analysis.metrics.caseCount);
  const scenarioCaseCount = Math.max(
    1,
    Math.round(
      (baselineCaseCount * (100 + clamp(config.volumeIncreasePct, -80, 200))) /
        100
    )
  );
  const arrivalRate = estimateArrivalRate(events, baselineCaseCount);
  const baselineMedians: number[] = [];
  const scenarioMedians: number[] = [];
  const seed = config.seed >>> 0 || 1;
  for (let replication = 0; replication < replications; replication += 1) {
    const replicationSeed =
      (seed + Math.imul(replication + 1, 2_654_435_761)) >>> 0;
    const baselineValues = simulateReplication({
      variants: analysis.variants,
      distributions,
      capacities: baselineCapacities,
      caseCount: baselineCaseCount,
      arrivalRatePerDay: arrivalRate,
      seed: replicationSeed,
      config: {
        ...config,
        resourceLoss: false,
        approvalSpeed: 1,
        automationActivity: "",
        approvalPolicy: "observed",
      },
      scenario: false,
    });
    const scenarioValues = simulateReplication({
      variants: analysis.variants,
      distributions,
      capacities,
      caseCount: scenarioCaseCount,
      arrivalRatePerDay: arrivalRate * (scenarioCaseCount / baselineCaseCount),
      seed: replicationSeed,
      config,
      scenario: true,
    });
    baselineMedians.push(quantile(baselineValues, 0.5));
    scenarioMedians.push(quantile(scenarioValues, 0.5));
  }
  const alpha = (1 - config.confidenceLevel) / 2;
  const baselineMedian = quantile(baselineMedians, 0.5);
  const scenarioMedian = quantile(scenarioMedians, 0.5);
  const observed = analysis.metrics.medianLeadDays;
  const validationError =
    observed > 0 ? (Math.abs(baselineMedian - observed) / observed) * 100 : 0;
  const validationStatus =
    validationError <= config.validationTolerancePct ? "passed" : "failed";
  if (validationStatus === "failed")
    warnings.add(
      "A reprodução histórica ficou fora da tolerância; o cenário não deve orientar decisões."
    );
  warnings.add(
    "Timestamps de conclusão não separam serviço de espera; distribuições representam gaps entre eventos."
  );
  const baseline = {
    median: baselineMedian,
    lower: quantile(baselineMedians, alpha),
    upper: quantile(baselineMedians, 1 - alpha),
    p05: quantile(baselineMedians, alpha),
    p95: quantile(baselineMedians, 1 - alpha),
  };
  const scenario = {
    median: scenarioMedian,
    lower: quantile(scenarioMedians, alpha),
    upper: quantile(scenarioMedians, 1 - alpha),
    p05: quantile(scenarioMedians, alpha),
    p95: quantile(scenarioMedians, 1 - alpha),
  };
  return {
    engineVersion: ENGINE_VERSION,
    replications,
    confidenceLevel: config.confidenceLevel,
    baselineCasesPerReplication: baselineCaseCount,
    scenarioCasesPerReplication: scenarioCaseCount,
    casesPerReplication: scenarioCaseCount,
    baseline,
    scenario,
    medianDeltaPct: baselineMedian
      ? ((scenarioMedian - baselineMedian) / baselineMedian) * 100
      : 0,
    arrivalVolumePct: 100 + config.volumeIncreasePct,
    seed,
    arrivalRatePerDay: arrivalRate,
    fittedDistributions: Object.fromEntries(
      Array.from(distributions.entries())
        .filter(([key]) => !key.endsWith("\u001f*"))
        .map(([key, distribution]) => [
          key,
          {
            family: distribution.family,
            sampleCount: distribution.sampleCount,
            parameters: distribution.parameters,
            ksStatistic: distribution.ksStatistic,
            bic: distribution.bic,
            warning: distribution.warning,
          },
        ])
    ),
    validation: {
      observedMedianDays: observed,
      simulatedMedianDays: baselineMedian,
      absolutePercentageError: validationError,
      tolerancePct: config.validationTolerancePct,
      status: validationStatus,
    },
    observedMedianDays: observed,
    warnings: Array.from(warnings),
  };
}

export function defaultScenarioConfig(): ScenarioConfig {
  return {
    volumeIncreasePct: 20,
    resourceLoss: false,
    approvalSpeed: 1,
    automationActivity: "",
    approvalPolicy: "observed",
    seed: 42_019,
    replications: 1_000,
    confidenceLevel: 0.95,
    validationTolerancePct: 20,
    calendar: {
      timezone: "America/Sao_Paulo",
      workingWeekdays: [1, 2, 3, 4, 5],
      workdayStartHour: 8,
      workdayEndHour: 18,
    },
  };
}
