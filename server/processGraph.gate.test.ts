import { describe, expect, it } from "vitest";
import {
  validateEvidenceClaims,
  type TrustedProcessFact,
} from "./processGraph.gate";

const facts: TrustedProcessFact[] = [
  {
    id: "bottleneck",
    label: "Maior espera",
    value: "4,2 dias",
    detail: "P90 7,0 dias; 24 transições.",
  },
  {
    id: "volume",
    label: "Volume",
    value: "150 casos",
    detail: "1.230 eventos observados.",
  },
];

const claim = (text: string, citations: string[] = ["bottleneck"]) => ({
  text,
  citations,
  type: "observacao" as const,
});

describe("processGraph evidence citation gate", () => {
  it("accepts ordinary narrative with existing citations and no model-authored figures", () => {
    const result = validateEvidenceClaims(
      { claims: [claim("A espera se concentra nessa transição do processo.")] },
      facts
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.citations).toEqual(["bottleneck"]);
    expect(result.rejected).toBe(0);
  });

  it("accepts routine Portuguese grammar such as artigo indefinido without confusing it with a metric", () => {
    const result = validateEvidenceClaims(
      {
        claims: [
          claim(
            "Uma hipótese útil é validar a ordem de entrada dos pedidos com a equipe responsável."
          ),
        ],
      },
      facts
    );
    expect(result.claims).toHaveLength(1);
  });

  it("rejects any invented numeric digit or percentage even when the citation ID exists", () => {
    const result = validateEvidenceClaims(
      { claims: [claim("A espera aumentou em 20% nesta etapa.")] },
      facts
    );
    expect(result.claims).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("rejects fabricated evidence IDs", () => {
    const result = validateEvidenceClaims(
      {
        claims: [
          claim("A distribuição observada merece verificação humana.", [
            "inventado",
          ]),
        ],
      },
      facts
    );
    expect(result.claims).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("rejects unsupported numbers written out as words", () => {
    const result = validateEvidenceClaims(
      {
        claims: [
          claim("Dois fatores não medidos podem influenciar a aprovação."),
        ],
      },
      facts
    );
    expect(result.claims).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it("rejects duplicate citation IDs and malformed structured output", () => {
    expect(
      validateEvidenceClaims(
        {
          claims: [
            claim("A espera merece análise da equipe.", [
              "bottleneck",
              "bottleneck",
            ]),
          ],
        },
        facts
      ).claims
    ).toHaveLength(0);
    expect(
      validateEvidenceClaims({ claim: "malformed" }, facts).claims
    ).toHaveLength(0);
  });
});
