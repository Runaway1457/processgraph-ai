export type PrimitiveAttribute = string | number | boolean | null;

export type ProcessEvent = {
  caseId: string;
  activity: string;
  timestamp: number;
  resource: string;
  lifecycle?: "start" | "complete" | "unknown";
  attributes?: Record<string, PrimitiveAttribute>;
};

export type DataQualityIssueCode =
  | "missing_required_value"
  | "invalid_timestamp"
  | "duplicate_event"
  | "out_of_order_event"
  | "single_event_case"
  | "missing_resource"
  | "negative_duration";

export type DataQualityIssue = {
  code: DataQualityIssueCode;
  severity: "warning" | "error";
  count: number;
  sampleCaseIds: string[];
  message: string;
};

export type DataQualityReport = {
  inputRows: number;
  acceptedEvents: number;
  rejectedRows: number;
  caseCount: number;
  completeness: number;
  issues: DataQualityIssue[];
  isUsable: boolean;
};

export type ParsedEventLog = {
  events: ProcessEvent[];
  quality: DataQualityReport;
  source: {
    format: "csv" | "xes";
    contentHash: string;
    hashAlgorithm: "fnv1a64";
  };
};

export type DistributionSummary = {
  count: number;
  mean: number;
  standardDeviation: number;
  minimum: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  maximum: number;
  iqr: number;
};

export type EdgeStat = {
  id: string;
  from: string;
  to: string;
  count: number;
  caseCount: number;
  frequency: number;
  waitDays: DistributionSummary;
  /** @deprecated Prefer waitDays.mean. */
  averageWaitDays: number;
  /** @deprecated Prefer waitDays.median. */
  medianWaitDays: number;
  /** @deprecated Prefer waitDays.p90. */
  p90WaitDays: number;
};

export type ActivityStat = {
  id: string;
  activity: string;
  count: number;
  caseCount: number;
  resources: string[];
  waitDays: DistributionSummary;
  /** @deprecated Prefer waitDays.mean. */
  averageWaitDays: number;
  /** @deprecated Prefer waitDays.median. */
  medianWaitDays: number;
  /** @deprecated Prefer waitDays.p90. */
  p90WaitDays: number;
};

export type VariantStat = {
  id: string;
  path: string[];
  count: number;
  share: number;
  leadDays: DistributionSummary;
  impactVsMedianDays: number;
  /** @deprecated Prefer leadDays.median. */
  medianLeadDays: number;
};

export type ProcessTreeNode =
  | { operator: "activity"; activity: string }
  | { operator: "tau" }
  | {
      operator: "sequence" | "xor" | "parallel" | "loop";
      children: ProcessTreeNode[];
    };

export type DiscoveredModel = {
  algorithm: "inductive-dfg";
  algorithmVersion: string;
  minEdgeFrequency: number;
  startActivities: string[];
  endActivities: string[];
  retainedEdgeIds: string[];
  retainedEdges: number;
  totalEdges: number;
  processTree: ProcessTreeNode;
  fallbackCount: number;
};

export type AlignmentMove = {
  kind: "sync" | "log" | "model";
  logActivity?: string;
  modelActivity?: string;
  cost: number;
};

export type TraceAlignment = {
  caseId: string;
  variantId: string;
  referenceVariantId: string;
  cost: number;
  normalizedFitness: number;
  isDeviation: boolean;
  moves: AlignmentMove[];
};

export type ConformanceSummary = {
  alignedCases: number;
  deviatingCases: number;
  deviationRate: number;
  meanAlignmentCost: number;
  medianAlignmentCost: number;
  fitness: number;
  precision: number;
  generalization: number;
  trainCases: number;
  validationCases: number;
  alignments: TraceAlignment[];
};

export type EvidenceFact = {
  id: string;
  kind:
    | "metric"
    | "distribution"
    | "variant"
    | "conformance"
    | "quality"
    | "simulation";
  label: string;
  value: string;
  detail: string;
  sourcePath: string;
};

export type ProcessAnalysis = {
  schemaVersion: "2.0";
  analysisId: string;
  sourceHash: string;
  generatedAt: string;
  metrics: {
    caseCount: number;
    eventCount: number;
    averageLeadDays: number;
    medianLeadDays: number;
    p90LeadDays: number;
    firstPassRate: number;
    transitionCount: number;
    deviationRate: number;
    fitness: number;
    precision: number;
  };
  quality: DataQualityReport;
  activities: ActivityStat[];
  edges: EdgeStat[];
  variants: VariantStat[];
  trend: { month: string; cases: number; medianLeadDays: number }[];
  model: DiscoveredModel;
  conformance: ConformanceSummary;
  evidence: EvidenceFact[];
};

export type CalendarConfig = {
  timezone: string;
  workingWeekdays: number[];
  workdayStartHour: number;
  workdayEndHour: number;
};

export type ScenarioConfig = {
  volumeIncreasePct: number;
  resourceLoss: boolean;
  approvalSpeed: number;
  automationActivity: string;
  approvalPolicy?: "observed" | "skip_manager_below_threshold";
  seed: number;
  replications: number;
  confidenceLevel: 0.95;
  validationTolerancePct: number;
  calendar: CalendarConfig;
};

export type FittedDistribution = {
  family: "constant" | "exponential" | "lognormal";
  sampleCount: number;
  parameters: Record<string, number>;
  ksStatistic: number;
  bic: number;
  warning?: string;
};

export type SimulationInterval = {
  median: number;
  lower: number;
  upper: number;
  /** @deprecated Prefer lower. */
  p05: number;
  /** @deprecated Prefer upper. */
  p95: number;
};

export type SimulationValidation = {
  observedMedianDays: number;
  simulatedMedianDays: number;
  absolutePercentageError: number;
  tolerancePct: number;
  status: "passed" | "failed";
};

export type SimulationResult = {
  engineVersion: string;
  replications: number;
  confidenceLevel: 0.95;
  baselineCasesPerReplication: number;
  scenarioCasesPerReplication: number;
  /** @deprecated Prefer scenarioCasesPerReplication. */
  casesPerReplication: number;
  baseline: SimulationInterval;
  scenario: SimulationInterval;
  medianDeltaPct: number;
  arrivalVolumePct: number;
  seed: number;
  arrivalRatePerDay: number;
  fittedDistributions: Record<string, FittedDistribution>;
  validation: SimulationValidation;
  /** @deprecated Prefer validation.observedMedianDays. */
  observedMedianDays: number;
  warnings: string[];
};
