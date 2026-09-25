import type { DistributionSummary } from "./types";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mean(values: readonly number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return (
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1)
  );
}

export function quantile(
  values: readonly number[],
  probability: number
): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

export function summarizeDistribution(
  values: readonly number[]
): DistributionSummary {
  const finite = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const p25 = quantile(finite, 0.25);
  const p75 = quantile(finite, 0.75);
  return {
    count: finite.length,
    mean: mean(finite),
    standardDeviation: Math.sqrt(variance(finite)),
    minimum: finite[0] ?? 0,
    p25,
    median: quantile(finite, 0.5),
    p75,
    p90: quantile(finite, 0.9),
    p95: quantile(finite, 0.95),
    maximum: finite[finite.length - 1] ?? 0,
    iqr: p75 - p25,
  };
}

export function stableHash(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

export function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

export function kolmogorovSmirnov(
  values: readonly number[],
  cdf: (value: number) => number
): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  let statistic = 0;
  sorted.forEach((value, index) => {
    const theoretical = clamp(cdf(value), 0, 1);
    const before = index / sorted.length;
    const after = (index + 1) / sorted.length;
    statistic = Math.max(
      statistic,
      Math.abs(theoretical - before),
      Math.abs(after - theoretical)
    );
  });
  return statistic;
}
