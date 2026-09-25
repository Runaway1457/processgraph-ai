import { stableHash } from "./statistics";
import type {
  DataQualityIssue,
  DataQualityIssueCode,
  ParsedEventLog,
  PrimitiveAttribute,
  ProcessEvent,
} from "./types";

const MAX_XML_BYTES = 20 * 1024 * 1024;

export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("O CSV contém um campo com aspas não fechado.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9:_]/g, "");
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return Number.NaN;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function parseAttribute(value: string): PrimitiveAttribute {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(?:true|false)$/i.test(trimmed))
    return trimmed.toLowerCase() === "true";
  const numeric = Number(trimmed.replace(",", "."));
  return Number.isFinite(numeric) && /^-?\d+(?:[.,]\d+)?$/.test(trimmed)
    ? numeric
    : trimmed;
}

type MutableIssue = { count: number; caseIds: Set<string> };

function qualityReport(
  events: ProcessEvent[],
  inputRows: number,
  rejectedRows: number,
  issueMap: Map<DataQualityIssueCode, MutableIssue>
) {
  const byCase = new Map<string, ProcessEvent[]>();
  for (const event of events) {
    const trace = byCase.get(event.caseId) ?? [];
    trace.push(event);
    byCase.set(event.caseId, trace);
    if (event.resource === "Não informado")
      addIssue(issueMap, "missing_resource", event.caseId);
  }
  for (const [caseId, trace] of byCase) {
    if (trace.length === 1) addIssue(issueMap, "single_event_case", caseId);
  }
  const definitions: Record<
    DataQualityIssueCode,
    { severity: "warning" | "error"; message: string }
  > = {
    missing_required_value: {
      severity: "error",
      message: "Linhas sem case_id ou atividade foram rejeitadas.",
    },
    invalid_timestamp: {
      severity: "error",
      message: "Linhas com timestamp inválido foram rejeitadas.",
    },
    duplicate_event: {
      severity: "warning",
      message: "Eventos duplicados foram removidos.",
    },
    out_of_order_event: {
      severity: "warning",
      message: "Eventos fora de ordem foram reordenados por caso.",
    },
    single_event_case: {
      severity: "warning",
      message: "Casos com um único evento não geram transições.",
    },
    missing_resource: {
      severity: "warning",
      message: "Eventos sem recurso limitam a análise de capacidade.",
    },
    negative_duration: {
      severity: "error",
      message: "Durações negativas foram detectadas.",
    },
  };
  const issues: DataQualityIssue[] = Array.from(issueMap.entries()).map(
    ([code, issue]) => ({
      code,
      severity: definitions[code].severity,
      count: issue.count,
      sampleCaseIds: Array.from(issue.caseIds).slice(0, 5),
      message: definitions[code].message,
    })
  );
  const requiredCells = Math.max(1, inputRows * 3);
  const rejectedRequiredCells = rejectedRows * 3;
  return {
    inputRows,
    acceptedEvents: events.length,
    rejectedRows,
    caseCount: byCase.size,
    completeness: Math.max(
      0,
      (requiredCells - rejectedRequiredCells) / requiredCells
    ),
    issues,
    isUsable:
      events.length >= 2 &&
      byCase.size >= 1 &&
      !issues.some(
        issue => issue.severity === "error" && issue.count === inputRows
      ),
  };
}

function addIssue(
  map: Map<DataQualityIssueCode, MutableIssue>,
  code: DataQualityIssueCode,
  caseId = "desconhecido"
): void {
  const issue = map.get(code) ?? { count: 0, caseIds: new Set<string>() };
  issue.count += 1;
  issue.caseIds.add(caseId || "desconhecido");
  map.set(code, issue);
}

function deduplicate(
  events: ProcessEvent[],
  issueMap: Map<DataQualityIssueCode, MutableIssue>
): ProcessEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.caseId}\u001f${event.activity}\u001f${event.timestamp}\u001f${event.resource}`;
    if (seen.has(key)) {
      addIssue(issueMap, "duplicate_event", event.caseId);
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortAndCheck(
  events: ProcessEvent[],
  issueMap: Map<DataQualityIssueCode, MutableIssue>
): ProcessEvent[] {
  const lastTimestamp = new Map<string, number>();
  for (const event of events) {
    const previous = lastTimestamp.get(event.caseId);
    if (previous !== undefined && event.timestamp < previous)
      addIssue(issueMap, "out_of_order_event", event.caseId);
    lastTimestamp.set(event.caseId, event.timestamp);
  }
  return [...events].sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      left.caseId.localeCompare(right.caseId)
  );
}

export function parseCsvLogDetailed(input: string): ParsedEventLog {
  const rows = parseCsvRows(input);
  if (rows.length < 2)
    throw new Error("O CSV precisa ter cabeçalho e pelo menos um evento.");
  const rawHeaders = rows[0] ?? [];
  const headers = rawHeaders.map(normalizeHeader);
  const find = (aliases: string[]) =>
    headers.findIndex(header => aliases.includes(header));
  const caseIndex = find([
    "case_id",
    "caseid",
    "case",
    "trace_id",
    "traceid",
    "id_caso",
    "caso",
  ]);
  const activityIndex = find([
    "activity",
    "atividade",
    "concept:name",
    "task",
    "event",
    "nomeatividade",
  ]);
  const timestampIndex = find([
    "timestamp",
    "time",
    "event_time",
    "completion_time",
    "datahora",
    "datetime",
    "time:timestamp",
  ]);
  const resourceIndex = find([
    "resource",
    "org:resource",
    "usuario",
    "responsavel",
    "worker",
    "assignee",
    "owner",
  ]);
  const lifecycleIndex = find(["lifecycle:transition", "lifecycle", "ciclo"]);
  const missing = [
    caseIndex < 0 && "case_id",
    activityIndex < 0 && "activity",
    timestampIndex < 0 && "timestamp",
  ].filter(Boolean);
  if (missing.length)
    throw new Error(`Colunas obrigatórias ausentes: ${missing.join(", ")}.`);

  const issueMap = new Map<DataQualityIssueCode, MutableIssue>();
  const events: ProcessEvent[] = [];
  let rejectedRows = 0;
  for (const row of rows.slice(1)) {
    const caseId = row[caseIndex]?.trim() ?? "";
    const activity = row[activityIndex]?.trim() ?? "";
    if (!caseId || !activity) {
      rejectedRows += 1;
      addIssue(issueMap, "missing_required_value", caseId);
      continue;
    }
    const timestamp = parseTimestamp(row[timestampIndex] ?? "");
    if (!Number.isFinite(timestamp)) {
      rejectedRows += 1;
      addIssue(issueMap, "invalid_timestamp", caseId);
      continue;
    }
    const ignored = new Set([
      caseIndex,
      activityIndex,
      timestampIndex,
      resourceIndex,
      lifecycleIndex,
    ]);
    const attributes = Object.fromEntries(
      rawHeaders.flatMap((header, index) =>
        ignored.has(index) || !header
          ? []
          : [[header, parseAttribute(row[index] ?? "")]]
      )
    );
    const lifecycleValue =
      lifecycleIndex >= 0 ? (row[lifecycleIndex] ?? "").toLowerCase() : "";
    const lifecycle =
      lifecycleValue === "start" || lifecycleValue === "complete"
        ? lifecycleValue
        : "unknown";
    events.push({
      caseId,
      activity,
      timestamp,
      resource:
        (resourceIndex >= 0 ? row[resourceIndex] : "")?.trim() ||
        "Não informado",
      lifecycle,
      attributes,
    });
  }
  const clean = sortAndCheck(deduplicate(events, issueMap), issueMap);
  if (clean.length < 2)
    throw new Error(
      "Não encontrei eventos válidos. Confira os campos e o formato das datas."
    );
  return {
    events: clean,
    quality: qualityReport(clean, rows.length - 1, rejectedRows, issueMap),
    source: {
      format: "csv",
      contentHash: stableHash(input),
      hashAlgorithm: "fnv1a64",
    },
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlAttribute(block: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(
      `<\\w+\\b(?=[^>]*\\bkey=["']${escaped}["'])[^>]*\\bvalue=["']([^"']*)["']`,
      "i"
    )
  );
  return match ? decodeXml(match[1] ?? "") : "";
}

export function parseXesLogDetailed(input: string): ParsedEventLog {
  if (new TextEncoder().encode(input).byteLength > MAX_XML_BYTES)
    throw new Error("O arquivo XES excede o limite de 20 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(input))
    throw new Error("O XES contém declarações XML não permitidas.");
  const issueMap = new Map<DataQualityIssueCode, MutableIssue>();
  const events: ProcessEvent[] = [];
  const traces = input.match(/<trace\b[\s\S]*?<\/trace>/gi) ?? [];
  let inputRows = 0;
  let rejectedRows = 0;
  traces.forEach((trace, traceIndex) => {
    const caseId =
      xmlAttribute(
        trace.slice(0, Math.max(0, trace.indexOf("<event"))),
        "concept:name"
      ) || `caso-${traceIndex + 1}`;
    const blocks = trace.match(/<event\b[\s\S]*?<\/event>/gi) ?? [];
    inputRows += blocks.length;
    for (const block of blocks) {
      const activity = xmlAttribute(block, "concept:name");
      const timestamp = parseTimestamp(xmlAttribute(block, "time:timestamp"));
      if (!activity) {
        rejectedRows += 1;
        addIssue(issueMap, "missing_required_value", caseId);
        continue;
      }
      if (!Number.isFinite(timestamp)) {
        rejectedRows += 1;
        addIssue(issueMap, "invalid_timestamp", caseId);
        continue;
      }
      const lifecycleValue = xmlAttribute(
        block,
        "lifecycle:transition"
      ).toLowerCase();
      events.push({
        caseId,
        activity,
        timestamp,
        resource: xmlAttribute(block, "org:resource") || "Não informado",
        lifecycle:
          lifecycleValue === "start" || lifecycleValue === "complete"
            ? lifecycleValue
            : "unknown",
      });
    }
  });
  const clean = sortAndCheck(deduplicate(events, issueMap), issueMap);
  if (clean.length < 2)
    throw new Error(
      "Não encontrei eventos XES válidos com concept:name e time:timestamp."
    );
  return {
    events: clean,
    quality: qualityReport(clean, inputRows, rejectedRows, issueMap),
    source: {
      format: "xes",
      contentHash: stableHash(input),
      hashAlgorithm: "fnv1a64",
    },
  };
}

export function parseEventLogDetailed(
  input: string,
  filename = ""
): ParsedEventLog {
  const isXes =
    filename.toLowerCase().endsWith(".xes") ||
    /<log\b|<trace\b/i.test(input.slice(0, 1_000));
  return isXes ? parseXesLogDetailed(input) : parseCsvLogDetailed(input);
}

export function parseCsvLog(input: string): ProcessEvent[] {
  return parseCsvLogDetailed(input).events;
}

export function parseXesLog(input: string): ProcessEvent[] {
  return parseXesLogDetailed(input).events;
}

export function parseEventLog(input: string, filename = ""): ProcessEvent[] {
  return parseEventLogDetailed(input, filename).events;
}
