import { z } from "zod";
import type { Tool } from "./_core/llm";
import type { EvidenceFact } from "../shared/processGraph";

const distributionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    mean: z.number().finite().nonnegative(),
    median: z.number().finite().nonnegative(),
    p90: z.number().finite().nonnegative(),
    p95: z.number().finite().nonnegative(),
    iqr: z.number().finite().nonnegative(),
  })
  .strict();

export const investigationSnapshotSchema = z
  .object({
    analysisId: z.string().min(1).max(80),
    sourceHash: z.string().min(8).max(128),
    facts: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            kind: z
              .enum([
                "metric",
                "distribution",
                "variant",
                "conformance",
                "quality",
                "simulation",
              ])
              .default("metric"),
            label: z.string().min(1).max(180),
            value: z.string().min(1).max(80),
            detail: z.string().min(1).max(400),
            sourcePath: z.string().min(1).max(240).default("legacy"),
          })
          .strict()
      )
      .min(1)
      .max(32),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            from: z.string().min(1).max(120),
            to: z.string().min(1).max(120),
            count: z.number().int().nonnegative(),
            waitDays: distributionSchema,
          })
          .strict()
      )
      .max(256),
    variants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            path: z.array(z.string().min(1).max(120)).min(1).max(80),
            count: z.number().int().nonnegative(),
            share: z.number().min(0).max(1),
            leadDays: distributionSchema,
            impactVsMedianDays: z.number().finite(),
          })
          .strict()
      )
      .max(128),
  })
  .strict();

export type InvestigationSnapshot = z.infer<typeof investigationSnapshotSchema>;

export const investigationTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "inspect_transition_distribution",
      description:
        "Consulta a distribuição de espera de uma transição já calculada. Não calcula nem inventa valores.",
      parameters: {
        type: "object",
        properties: { edgeId: { type: "string" } },
        required: ["edgeId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_variants",
      description:
        "Compara duas variantes existentes por frequência e distribuição de lead time.",
      parameters: {
        type: "object",
        properties: { leftId: { type: "string" }, rightId: { type: "string" } },
        required: ["leftId", "rightId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rank_bottlenecks",
      description:
        "Retorna as transições de maior espera mediana com limite pequeno.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 5 } },
        required: ["limit"],
        additionalProperties: false,
      },
    },
  },
];

const callSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("inspect_transition_distribution"),
      arguments: z.object({ edgeId: z.string().min(1).max(80) }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("compare_variants"),
      arguments: z
        .object({
          leftId: z.string().min(1).max(80),
          rightId: z.string().min(1).max(80),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("rank_bottlenecks"),
      arguments: z.object({ limit: z.number().int().min(1).max(5) }).strict(),
    })
    .strict(),
]);

export type InvestigationToolCall = z.infer<typeof callSchema>;

export type ToolAuditStep = {
  sequence: number;
  tool: InvestigationToolCall["name"];
  status: "accepted" | "rejected";
  input: Record<string, string | number>;
  evidenceIds: string[];
  reason?: string;
};

function formatDays(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} dias`;
}

function edgeFact(edge: InvestigationSnapshot["edges"][number]): EvidenceFact {
  return {
    id: `tool-${edge.id}`.slice(0, 40),
    kind: "distribution",
    label: `${edge.from} → ${edge.to}`,
    value: `mediana ${formatDays(edge.waitDays.median)}`,
    detail: `P90 ${formatDays(edge.waitDays.p90)}; P95 ${formatDays(edge.waitDays.p95)}; IQR ${formatDays(edge.waitDays.iqr)}; ${edge.count.toLocaleString("pt-BR")} ocorrências.`,
    sourcePath: `edges.${edge.id}.waitDays`,
  };
}

function variantFact(
  variant: InvestigationSnapshot["variants"][number],
  side: "left" | "right"
): EvidenceFact {
  return {
    id: `tool-${side}-${variant.id}`.slice(0, 40),
    kind: "variant",
    label: `Variante ${variant.id}`,
    value: `${variant.count.toLocaleString("pt-BR")} casos`,
    detail: `Participação ${(variant.share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%; mediana ${formatDays(variant.leadDays.median)}; P90 ${formatDays(variant.leadDays.p90)}; impacto ${formatDays(variant.impactVsMedianDays)}.`,
    sourcePath: `variants.${variant.id}`,
  };
}

export function parseToolCall(
  name: string,
  rawArguments: string
): InvestigationToolCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error("Argumentos da ferramenta não são JSON válido.");
  }
  return callSchema.parse({ name, arguments: parsed });
}

export function executeInvestigationTool(
  call: InvestigationToolCall,
  snapshot: InvestigationSnapshot
): EvidenceFact[] {
  if (call.name === "inspect_transition_distribution") {
    const edge = snapshot.edges.find(
      candidate => candidate.id === call.arguments.edgeId
    );
    if (!edge) throw new Error("Transição fora do escopo autorizado.");
    return [edgeFact(edge)];
  }
  if (call.name === "compare_variants") {
    if (call.arguments.leftId === call.arguments.rightId)
      throw new Error("A comparação exige duas variantes distintas.");
    const left = snapshot.variants.find(
      candidate => candidate.id === call.arguments.leftId
    );
    const right = snapshot.variants.find(
      candidate => candidate.id === call.arguments.rightId
    );
    if (!left || !right) throw new Error("Variante fora do escopo autorizado.");
    return [variantFact(left, "left"), variantFact(right, "right")];
  }
  return [...snapshot.edges]
    .sort(
      (left, right) =>
        right.waitDays.median - left.waitDays.median ||
        right.count - left.count ||
        left.id.localeCompare(right.id)
    )
    .slice(0, call.arguments.limit)
    .map(edgeFact);
}
