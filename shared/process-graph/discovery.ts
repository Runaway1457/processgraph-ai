import {
  mean,
  quantile,
  stableHash,
  summarizeDistribution,
} from "./statistics";
import type {
  ActivityStat,
  AlignmentMove,
  ConformanceSummary,
  DataQualityReport,
  DiscoveredModel,
  EdgeStat,
  EvidenceFact,
  ProcessAnalysis,
  ProcessEvent,
  ProcessTreeNode,
  TraceAlignment,
  VariantStat,
} from "./types";

const DAY_MS = 86_400_000;
const MODEL_VERSION = "2.0.0";

type Trace = {
  caseId: string;
  events: ProcessEvent[];
  path: string[];
  leadDays: number;
};

function edgeId(from: string, to: string): string {
  return `edge:${stableHash(`${from}\u001f${to}`)}`;
}

function activityId(activity: string): string {
  return `activity:${stableHash(activity)}`;
}

function variantId(path: readonly string[]): string {
  return `variant:${stableHash(path.join("\u001f"))}`;
}

function formatDays(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`;
}

export function buildTraces(events: readonly ProcessEvent[]): Trace[] {
  const grouped = new Map<string, ProcessEvent[]>();
  for (const event of events) {
    if (!event.caseId || !event.activity || !Number.isFinite(event.timestamp))
      continue;
    const trace = grouped.get(event.caseId) ?? [];
    trace.push(event);
    grouped.set(event.caseId, trace);
  }
  return Array.from(grouped.entries())
    .map(([caseId, unsorted]) => {
      const sorted = [...unsorted].sort(
        (left, right) => left.timestamp - right.timestamp
      );
      return {
        caseId,
        events: sorted,
        path: sorted.map(event => event.activity),
        leadDays: Math.max(
          0,
          ((sorted.at(-1)?.timestamp ?? 0) - (sorted[0]?.timestamp ?? 0)) /
            DAY_MS
        ),
      };
    })
    .filter(trace => trace.events.length > 0)
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function graphEdges(paths: readonly string[][]): Set<string> {
  const edges = new Set<string>();
  for (const path of paths) {
    for (let index = 0; index < path.length - 1; index += 1)
      edges.add(`${path[index]}\u001f${path[index + 1]}`);
  }
  return edges;
}

function connectedComponents(
  nodes: readonly string[],
  adjacency: Map<string, Set<string>>
): string[][] {
  const remaining = new Set(nodes);
  const result: string[][] = [];
  while (remaining.size) {
    const seed = Array.from(remaining).sort()[0];
    const queue = [seed];
    const component: string[] = [];
    remaining.delete(seed);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (remaining.delete(neighbour)) queue.push(neighbour);
      }
    }
    result.push(component.sort());
  }
  return result.sort((left, right) =>
    (left[0] ?? "").localeCompare(right[0] ?? "")
  );
}

function stronglyConnectedComponents(
  nodes: readonly string[],
  edges: Set<string>
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string) => {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    const targets = nodes
      .filter(candidate => edges.has(`${node}\u001f${candidate}`))
      .sort();
    for (const target of targets) {
      if (!indices.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node)!, indices.get(target)!));
      }
    }
    if (low.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member = "";
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.sort());
    }
  };
  nodes.forEach(node => {
    if (!indices.has(node)) visit(node);
  });
  return components;
}

function projectPaths(
  paths: readonly string[][],
  activities: Set<string>
): string[][] {
  return paths
    .map(path => path.filter(activity => activities.has(activity)))
    .filter(path => path.length > 0);
}

function discoverTree(
  paths: readonly string[][],
  depth = 0
): { tree: ProcessTreeNode; fallbacks: number } {
  const activities = Array.from(new Set(paths.flat())).sort();
  if (!activities.length) return { tree: { operator: "tau" }, fallbacks: 0 };
  if (activities.length === 1) {
    const repeated = paths.some(
      path => path.filter(activity => activity === activities[0]).length > 1
    );
    if (repeated)
      return {
        tree: {
          operator: "loop",
          children: [
            { operator: "activity", activity: activities[0] },
            { operator: "tau" },
          ],
        },
        fallbacks: 0,
      };
    return {
      tree: { operator: "activity", activity: activities[0] },
      fallbacks: 0,
    };
  }
  if (depth > 24)
    return {
      tree: {
        operator: "xor",
        children: activities.map(activity => ({
          operator: "activity",
          activity,
        })),
      },
      fallbacks: 1,
    };

  const edges = graphEdges(paths);
  const undirected = new Map<string, Set<string>>(
    activities.map(activity => [activity, new Set()])
  );
  for (const edge of edges) {
    const [from, to] = edge.split("\u001f");
    if (from && to) {
      undirected.get(from)?.add(to);
      undirected.get(to)?.add(from);
    }
  }
  const xorParts = connectedComponents(activities, undirected);
  if (xorParts.length > 1) {
    const children = xorParts.map(part =>
      discoverTree(projectPaths(paths, new Set(part)), depth + 1)
    );
    return {
      tree: { operator: "xor", children: children.map(child => child.tree) },
      fallbacks: children.reduce((sum, child) => sum + child.fallbacks, 0),
    };
  }

  const components = stronglyConnectedComponents(activities, edges);
  if (components.length > 1) {
    const componentIndex = new Map(
      components.flatMap((component, componentId) =>
        component.map(activity => [activity, componentId] as const)
      )
    );
    const indegree = components.map(() => 0);
    const outgoing = components.map(() => new Set<number>());
    for (const edge of edges) {
      const [from, to] = edge.split("\u001f");
      const source = componentIndex.get(from ?? "");
      const target = componentIndex.get(to ?? "");
      if (
        source !== undefined &&
        target !== undefined &&
        source !== target &&
        !outgoing[source].has(target)
      ) {
        outgoing[source].add(target);
        indegree[target] += 1;
      }
    }
    const layers: number[][] = [];
    let queue = indegree
      .map((value, componentId) => ({ value, componentId }))
      .filter(({ value }) => value === 0)
      .map(({ componentId }) => componentId)
      .sort();
    while (queue.length) {
      const layer = [...queue];
      layers.push(layer);
      const next: number[] = [];
      for (const componentId of layer) {
        for (const target of outgoing[componentId]) {
          indegree[target] -= 1;
          if (indegree[target] === 0) next.push(target);
        }
      }
      queue = next.sort();
    }
    if (layers.flat().length === components.length) {
      const children = layers.map(layer => {
        const activitiesInLayer = layer.flatMap(
          componentId => components[componentId]
        );
        return discoverTree(
          projectPaths(paths, new Set(activitiesInLayer)),
          depth + 1
        );
      });
      return {
        tree: {
          operator: "sequence",
          children: children.map(child => child.tree),
        },
        fallbacks: children.reduce((sum, child) => sum + child.fallbacks, 0),
      };
    }
  }

  const allConcurrent = activities.every((left, leftIndex) =>
    activities
      .slice(leftIndex + 1)
      .every(
        right =>
          edges.has(`${left}\u001f${right}`) &&
          edges.has(`${right}\u001f${left}`)
      )
  );
  if (allConcurrent)
    return {
      tree: {
        operator: "parallel",
        children: activities.map(activity => ({
          operator: "activity",
          activity,
        })),
      },
      fallbacks: 0,
    };

  const uniquePaths = Array.from(
    new Map(paths.map(path => [path.join("\u001f"), path])).values()
  );
  const children = uniquePaths.slice(0, 24).map(path =>
    path.length === 1
      ? ({ operator: "activity", activity: path[0] } as ProcessTreeNode)
      : ({
          operator: "sequence",
          children: path.map(activity => ({
            operator: "activity",
            activity,
          })),
        } as ProcessTreeNode)
  );
  return { tree: { operator: "xor", children }, fallbacks: 1 };
}

export function discoverProcessModel(
  traces: readonly Trace[],
  minEdgeFrequency?: number
): DiscoveredModel {
  const threshold =
    minEdgeFrequency ?? Math.max(1, Math.ceil(traces.length * 0.01));
  const counts = new Map<string, number>();
  for (const trace of traces) {
    for (let index = 0; index < trace.path.length - 1; index += 1) {
      const id = edgeId(trace.path[index], trace.path[index + 1]);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const tree = discoverTree(traces.map(trace => trace.path));
  return {
    algorithm: "inductive-dfg",
    algorithmVersion: MODEL_VERSION,
    minEdgeFrequency: threshold,
    startActivities: Array.from(
      new Set(traces.map(trace => trace.path[0]).filter(Boolean))
    ).sort(),
    endActivities: Array.from(
      new Set(
        traces
          .map(trace => trace.path.at(-1))
          .filter((value): value is string => Boolean(value))
      )
    ).sort(),
    retainedEdgeIds: Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([id]) => id)
      .sort(),
    retainedEdges: Array.from(counts.values()).filter(
      count => count >= threshold
    ).length,
    totalEdges: counts.size,
    processTree: tree.tree,
    fallbackCount: tree.fallbacks,
  };
}

function alignPaths(
  logPath: readonly string[],
  modelPath: readonly string[]
): AlignmentMove[] {
  const rows = logPath.length + 1;
  const columns = modelPath.length + 1;
  const cost = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0)
  );
  const move = Array.from({ length: rows }, () =>
    Array<"sync" | "log" | "model">(columns).fill("sync")
  );
  for (let row = 1; row < rows; row += 1) {
    cost[row][0] = row;
    move[row][0] = "log";
  }
  for (let column = 1; column < columns; column += 1) {
    cost[0][column] = column;
    move[0][column] = "model";
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      if (logPath[row - 1] === modelPath[column - 1]) {
        cost[row][column] = cost[row - 1][column - 1];
        move[row][column] = "sync";
      } else {
        const candidates = [
          { value: cost[row - 1][column] + 1, kind: "log" as const },
          { value: cost[row][column - 1] + 1, kind: "model" as const },
          { value: cost[row - 1][column - 1] + 2, kind: "log" as const },
        ].sort(
          (left, right) =>
            left.value - right.value || left.kind.localeCompare(right.kind)
        );
        cost[row][column] = candidates[0].value;
        move[row][column] = candidates[0].kind;
      }
    }
  }
  const result: AlignmentMove[] = [];
  let row = logPath.length;
  let column = modelPath.length;
  while (row > 0 || column > 0) {
    const kind = move[row][column];
    if (kind === "sync") {
      result.push({
        kind,
        logActivity: logPath[row - 1],
        modelActivity: modelPath[column - 1],
        cost: 0,
      });
      row -= 1;
      column -= 1;
    } else if (kind === "log") {
      result.push({ kind, logActivity: logPath[row - 1], cost: 1 });
      row -= 1;
    } else {
      result.push({ kind, modelActivity: modelPath[column - 1], cost: 1 });
      column -= 1;
    }
  }
  return result.reverse();
}

function conformance(
  train: readonly Trace[],
  validation: readonly Trace[]
): ConformanceSummary {
  const references = Array.from(
    new Map(
      train.map(trace => [trace.path.join("\u001f"), trace.path])
    ).values()
  );
  const referenceEdges = graphEdges(references);
  const validationEdges = graphEdges(validation.map(trace => trace.path));
  const alignments: TraceAlignment[] = validation.map(trace => {
    const candidates = references.map(path => ({
      path,
      moves: alignPaths(trace.path, path),
    }));
    const best = candidates.sort(
      (left, right) =>
        left.moves.reduce((sum, item) => sum + item.cost, 0) -
          right.moves.reduce((sum, item) => sum + item.cost, 0) ||
        left.path.join("\u001f").localeCompare(right.path.join("\u001f"))
    )[0];
    const cost =
      best?.moves.reduce((sum, item) => sum + item.cost, 0) ??
      trace.path.length;
    const denominator = Math.max(
      1,
      trace.path.length + (best?.path.length ?? 0)
    );
    return {
      caseId: trace.caseId,
      variantId: variantId(trace.path),
      referenceVariantId: variantId(best?.path ?? []),
      cost,
      normalizedFitness: Math.max(0, 1 - cost / denominator),
      isDeviation: cost > 0,
      moves:
        best?.moves ??
        trace.path.map(activity => ({
          kind: "log" as const,
          logActivity: activity,
          cost: 1,
        })),
    };
  });
  const costs = alignments.map(alignment => alignment.cost);
  const coveredValidationEdges = Array.from(validationEdges).filter(edge =>
    referenceEdges.has(edge)
  ).length;
  const coveredReferenceEdges = Array.from(referenceEdges).filter(edge =>
    validationEdges.has(edge)
  ).length;
  return {
    alignedCases: alignments.length,
    deviatingCases: alignments.filter(alignment => alignment.isDeviation)
      .length,
    deviationRate: alignments.length
      ? alignments.filter(alignment => alignment.isDeviation).length /
        alignments.length
      : 0,
    meanAlignmentCost: mean(costs),
    medianAlignmentCost: quantile(costs, 0.5),
    fitness: alignments.length
      ? mean(alignments.map(alignment => alignment.normalizedFitness))
      : 1,
    precision: referenceEdges.size
      ? coveredReferenceEdges / referenceEdges.size
      : 1,
    generalization: validationEdges.size
      ? coveredValidationEdges / validationEdges.size
      : 1,
    trainCases: train.length,
    validationCases: validation.length,
    alignments,
  };
}

function defaultQuality(
  events: readonly ProcessEvent[],
  traces: readonly Trace[]
): DataQualityReport {
  return {
    inputRows: events.length,
    acceptedEvents: events.length,
    rejectedRows: 0,
    caseCount: traces.length,
    completeness: 1,
    issues: [],
    isUsable: events.length >= 2,
  };
}

export function analyzeProcess(
  events: readonly ProcessEvent[],
  options: {
    sourceHash?: string;
    quality?: DataQualityReport;
    validationModulo?: number;
  } = {}
): ProcessAnalysis {
  if (events.length < 2)
    throw new Error(
      "São necessários ao menos dois eventos para analisar o processo."
    );
  const traces = buildTraces(events);
  if (!traces.length) throw new Error("O log não contém casos válidos.");
  const validationModulo = Math.max(3, options.validationModulo ?? 5);
  let validation = traces.filter(
    trace =>
      Number.parseInt(stableHash(trace.caseId).slice(0, 8), 16) %
        validationModulo ===
      0
  );
  let train = traces.filter(trace => !validation.includes(trace));
  if (!validation.length || !train.length) {
    const split = Math.max(1, Math.floor(traces.length * 0.8));
    train = traces.slice(0, split);
    validation = traces.slice(split);
  }
  if (!validation.length) validation = train;

  const edgeAccumulator = new Map<
    string,
    { from: string; to: string; waits: number[]; cases: Set<string> }
  >();
  const activityAccumulator = new Map<
    string,
    {
      count: number;
      waits: number[];
      cases: Set<string>;
      resources: Set<string>;
    }
  >();
  const variantAccumulator = new Map<
    string,
    { path: string[]; leads: number[] }
  >();
  const trendAccumulator = new Map<
    string,
    { cases: number; leads: number[] }
  >();
  let transitionCount = 0;
  let firstPassCases = 0;
  for (const trace of traces) {
    if (new Set(trace.path).size === trace.path.length) firstPassCases += 1;
    const variant = variantAccumulator.get(trace.path.join("\u001f")) ?? {
      path: trace.path,
      leads: [],
    };
    variant.leads.push(trace.leadDays);
    variantAccumulator.set(trace.path.join("\u001f"), variant);
    const month = new Date(trace.events.at(-1)?.timestamp ?? 0)
      .toISOString()
      .slice(0, 7);
    const monthly = trendAccumulator.get(month) ?? { cases: 0, leads: [] };
    monthly.cases += 1;
    monthly.leads.push(trace.leadDays);
    trendAccumulator.set(month, monthly);
    trace.events.forEach((event, index) => {
      const activity = activityAccumulator.get(event.activity) ?? {
        count: 0,
        waits: [],
        cases: new Set<string>(),
        resources: new Set<string>(),
      };
      activity.count += 1;
      activity.cases.add(trace.caseId);
      if (event.resource && event.resource !== "Não informado")
        activity.resources.add(event.resource);
      const next = trace.events[index + 1];
      if (next) {
        const wait = Math.max(0, (next.timestamp - event.timestamp) / DAY_MS);
        activity.waits.push(wait);
        const id = edgeId(event.activity, next.activity);
        const edge = edgeAccumulator.get(id) ?? {
          from: event.activity,
          to: next.activity,
          waits: [],
          cases: new Set<string>(),
        };
        edge.waits.push(wait);
        edge.cases.add(trace.caseId);
        edgeAccumulator.set(id, edge);
        transitionCount += 1;
      }
      activityAccumulator.set(event.activity, activity);
    });
  }
  const edges: EdgeStat[] = Array.from(edgeAccumulator.entries())
    .map(([id, edge]) => {
      const waitDays = summarizeDistribution(edge.waits);
      return {
        id,
        from: edge.from,
        to: edge.to,
        count: edge.waits.length,
        caseCount: edge.cases.size,
        frequency: edge.waits.length / Math.max(1, transitionCount),
        waitDays,
        averageWaitDays: waitDays.mean,
        medianWaitDays: waitDays.median,
        p90WaitDays: waitDays.p90,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count || left.id.localeCompare(right.id)
    );
  const activities: ActivityStat[] = Array.from(activityAccumulator.entries())
    .map(([activity, accumulator]) => {
      const waitDays = summarizeDistribution(accumulator.waits);
      return {
        id: activityId(activity),
        activity,
        count: accumulator.count,
        caseCount: accumulator.cases.size,
        resources: Array.from(accumulator.resources).sort(),
        waitDays,
        averageWaitDays: waitDays.mean,
        medianWaitDays: waitDays.median,
        p90WaitDays: waitDays.p90,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count || left.activity.localeCompare(right.activity)
    );
  const overallMedian = quantile(
    traces.map(trace => trace.leadDays),
    0.5
  );
  const variants: VariantStat[] = Array.from(variantAccumulator.values())
    .map(variant => {
      const leadDays = summarizeDistribution(variant.leads);
      return {
        id: variantId(variant.path),
        path: variant.path,
        count: variant.leads.length,
        share: variant.leads.length / traces.length,
        leadDays,
        impactVsMedianDays: leadDays.median - overallMedian,
        medianLeadDays: leadDays.median,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.impactVsMedianDays - left.impactVsMedianDays ||
        left.id.localeCompare(right.id)
    );
  const model = discoverProcessModel(train);
  const conformity = conformance(train, validation);
  const leadSummary = summarizeDistribution(
    traces.map(trace => trace.leadDays)
  );
  const bottleneck = [...edges].sort(
    (left, right) =>
      right.waitDays.median - left.waitDays.median || right.count - left.count
  )[0];
  const quality = options.quality ?? defaultQuality(events, traces);
  const sourceHash =
    options.sourceHash ??
    stableHash(
      events
        .map(
          event =>
            `${event.caseId}|${event.activity}|${event.timestamp}|${event.resource}`
        )
        .join("\n")
    );
  const generatedAt = new Date(
    Math.max(...events.map(event => event.timestamp))
  ).toISOString();
  const analysisId = `analysis:${stableHash(`${sourceHash}|${MODEL_VERSION}|${traces.length}`)}`;
  const evidence: EvidenceFact[] = [
    {
      id: "lead-time",
      kind: "distribution",
      label: "Lead time mediano",
      value: formatDays(leadSummary.median),
      detail: `P90 ${formatDays(leadSummary.p90)}; média ${formatDays(leadSummary.mean)}; ${traces.length.toLocaleString("pt-BR")} casos.`,
      sourcePath: "metrics.medianLeadDays",
    },
    {
      id: "volume",
      kind: "metric",
      label: "Volume observado",
      value: `${traces.length.toLocaleString("pt-BR")} casos`,
      detail: `${events.length.toLocaleString("pt-BR")} eventos e ${activities.length.toLocaleString("pt-BR")} atividades.`,
      sourcePath: "metrics.caseCount",
    },
    {
      id: "conformance",
      kind: "conformance",
      label: "Conformidade em holdout",
      value: `${(conformity.fitness * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% fitness`,
      detail: `Precisão ${(conformity.precision * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%; generalização ${(conformity.generalization * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%; ${conformity.validationCases} casos no holdout.`,
      sourcePath: "conformance",
    },
    {
      id: "data-quality",
      kind: "quality",
      label: "Completude de campos obrigatórios",
      value: `${(quality.completeness * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      detail: `${quality.rejectedRows.toLocaleString("pt-BR")} linhas rejeitadas; ${quality.issues.length.toLocaleString("pt-BR")} tipos de alerta.`,
      sourcePath: "quality",
    },
  ];
  if (bottleneck)
    evidence.push({
      id: "bottleneck",
      kind: "distribution",
      label: `Maior espera mediana · ${bottleneck.from} → ${bottleneck.to}`,
      value: formatDays(bottleneck.waitDays.median),
      detail: `P90 ${formatDays(bottleneck.waitDays.p90)}; IQR ${formatDays(bottleneck.waitDays.iqr)}; ${bottleneck.count.toLocaleString("pt-BR")} ocorrências.`,
      sourcePath: `edges.${bottleneck.id}.waitDays`,
    });
  variants.slice(0, 3).forEach((variant, index) =>
    evidence.push({
      id: `variant-${index + 1}`,
      kind: "variant",
      label: `Variante ${index + 1}`,
      value: `${variant.count.toLocaleString("pt-BR")} casos · ${(variant.share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      detail: `Lead mediano ${formatDays(variant.leadDays.median)}; impacto ${formatDays(variant.impactVsMedianDays)}; ${variant.path.join(" → ")}.`,
      sourcePath: `variants.${variant.id}`,
    })
  );

  return {
    schemaVersion: "2.0",
    analysisId,
    sourceHash,
    generatedAt,
    metrics: {
      caseCount: traces.length,
      eventCount: events.length,
      averageLeadDays: leadSummary.mean,
      medianLeadDays: leadSummary.median,
      p90LeadDays: leadSummary.p90,
      firstPassRate: firstPassCases / traces.length,
      transitionCount,
      deviationRate: conformity.deviationRate,
      fitness: conformity.fitness,
      precision: conformity.precision,
    },
    quality,
    activities,
    edges,
    variants,
    trend: Array.from(trendAccumulator.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, values]) => ({
        month,
        cases: values.cases,
        medianLeadDays: quantile(values.leads, 0.5),
      })),
    model,
    conformance: conformity,
    evidence,
  };
}
