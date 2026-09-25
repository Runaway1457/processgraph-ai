export * from "./process-graph/types";
export * from "./process-graph/statistics";
export * from "./process-graph/ingestion";
export * from "./process-graph/discovery";
export * from "./process-graph/simulation";

import type { ProcessAnalysis, ProcessEvent } from "./process-graph/types";

const DAY_MS = 86_400_000;
const DAY_HOURS = 24;

export function makeDemoLog(seed = 20260924, caseCount = 428): ProcessEvent[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const now = Date.UTC(2026, 8, 24, 12);
  const start = now - 90 * DAY_MS;
  const variants = [
    {
      weight: 0.64,
      path: [
        "Requisição criada",
        "Validação de orçamento",
        "Aprovação gerencial",
        "Cotação com fornecedor",
        "Pedido emitido",
        "Recebimento de mercadoria",
        "Conferência fiscal",
        "Pagamento liberado",
      ],
    },
    {
      weight: 0.81,
      path: [
        "Requisição criada",
        "Validação de orçamento",
        "Análise financeira",
        "Aprovação gerencial",
        "Cotação com fornecedor",
        "Pedido emitido",
        "Recebimento de mercadoria",
        "Conferência fiscal",
        "Pagamento liberado",
      ],
    },
    {
      weight: 0.91,
      path: [
        "Requisição criada",
        "Validação de orçamento",
        "Aprovação gerencial",
        "Revisão jurídica",
        "Cotação com fornecedor",
        "Pedido emitido",
        "Recebimento de mercadoria",
        "Conferência fiscal",
        "Pagamento liberado",
      ],
    },
    {
      weight: 1,
      path: [
        "Requisição criada",
        "Validação de orçamento",
        "Aprovação gerencial",
        "Cotação com fornecedor",
        "Solicitação de ajuste",
        "Aprovação gerencial",
        "Cotação com fornecedor",
        "Pedido emitido",
        "Recebimento de mercadoria",
        "Conferência fiscal",
        "Pagamento liberado",
      ],
    },
  ];
  const resources: Record<string, string[]> = {
    "Requisição criada": ["Portal de compras", "Comprador 04", "Comprador 07"],
    "Validação de orçamento": [
      "Financeiro 02",
      "Financeiro 05",
      "ERP automático",
      "Financeiro 08",
    ],
    "Aprovação gerencial": [
      "Gerente 01",
      "Gerente 02",
      "Gerente 03",
      "Diretoria 01",
    ],
    "Análise financeira": ["Financeiro 02", "Financeiro 05"],
    "Cotação com fornecedor": [
      "Comprador 04",
      "Comprador 07",
      "Comprador 11",
      "Comprador 14",
      "Comprador 19",
    ],
    "Revisão jurídica": ["Jurídico 01", "Jurídico 02"],
    "Solicitação de ajuste": ["Comprador 11", "Comprador 14"],
    "Pedido emitido": ["ERP automático", "Comprador 04"],
    "Recebimento de mercadoria": [
      "Almoxarifado 03",
      "Almoxarifado 06",
      "Almoxarifado 09",
    ],
    "Conferência fiscal": ["Fiscal 01", "Fiscal 03", "Fiscal 04"],
    "Pagamento liberado": [
      "Contas a pagar 02",
      "Contas a pagar 05",
      "Tesouraria 01",
    ],
  };
  const gaps: Record<string, number> = {
    "Requisição criada": 0.08,
    "Validação de orçamento": 0.75,
    "Análise financeira": 1.6,
    "Aprovação gerencial": 2.2,
    "Cotação com fornecedor": 2.7,
    "Solicitação de ajuste": 0.9,
    "Revisão jurídica": 2.2,
    "Pedido emitido": 0.25,
    "Recebimento de mercadoria": 1.9,
    "Conferência fiscal": 2.5,
    "Pagamento liberado": 0.2,
  };
  const events: ProcessEvent[] = [];
  for (let index = 0; index < caseCount; index += 1) {
    const roll = random();
    const path =
      variants.find(variant => roll < variant.weight)?.path ?? variants[0].path;
    let time = start + random() * 90 * DAY_MS;
    const caseId = `OC-${String(10_001 + index)}`;
    for (const activity of path) {
      const candidates = resources[activity] ?? ["Operação 01"];
      events.push({
        caseId,
        activity,
        timestamp: Math.round(time),
        resource: candidates[Math.floor(random() * candidates.length)],
        lifecycle: "complete",
        attributes: {
          source: "synthetic-demo",
          amountBand: index % 5 === 0 ? "high" : "standard",
        },
      });
      const base = gaps[activity] ?? 0.8;
      time += Math.round(base * (0.58 + random() * 1.05) * DAY_MS);
    }
  }
  return events.sort((left, right) => left.timestamp - right.timestamp);
}

export function formatDuration(days: number): string {
  if (days < 1)
    return `${Math.round(days * DAY_HOURS).toLocaleString("pt-BR")} h`;
  return `${days.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`;
}

export function eventCountByCase(events: readonly ProcessEvent[]): number {
  return new Set(events.map(event => event.caseId)).size;
}

export function eventTimestampLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function variantDiversity(analysis: ProcessAnalysis): number {
  return analysis.variants.length;
}

export function toCsv(events: readonly ProcessEvent[]): string {
  const attributeNames = Array.from(
    new Set(events.flatMap(event => Object.keys(event.attributes ?? {})))
  ).sort();
  const quote = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = [
    "case_id",
    "activity",
    "timestamp",
    "resource",
    "lifecycle",
    ...attributeNames,
  ].join(",");
  const rows = events.map(event =>
    [
      event.caseId,
      event.activity,
      new Date(event.timestamp).toISOString(),
      event.resource,
      event.lifecycle ?? "unknown",
      ...attributeNames.map(name => event.attributes?.[name] ?? ""),
    ]
      .map(quote)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export const DAY_IN_MS = DAY_MS;
export const HOURS_IN_DAY = DAY_HOURS;
