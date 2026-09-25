import { z } from "zod";

export const processFactSchema = z
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
      .optional(),
    label: z.string().min(1).max(180),
    value: z.string().min(1).max(80),
    detail: z.string().min(1).max(400),
    sourcePath: z.string().min(1).max(240).optional(),
  })
  .strict();

export const processClaimSchema = z
  .object({
    text: z.string().min(12).max(360),
    citations: z.array(z.string().min(1).max(40)).min(1).max(4),
    type: z.enum(["observacao", "hipotese"]),
  })
  .strict();

export const processClaimsSchema = z
  .object({ claims: z.array(processClaimSchema).max(8) })
  .strict();

export type TrustedProcessFact = z.infer<typeof processFactSchema>;
export type ProcessClaim = z.infer<typeof processClaimSchema>;

export function validateEvidenceClaims(
  value: unknown,
  facts: TrustedProcessFact[]
) {
  const result = processClaimsSchema.safeParse(value);
  if (!result.success) {
    return {
      claims: [] as ProcessClaim[],
      rejected: 1,
      message: "A resposta do modelo não passou pela validação de formato.",
    };
  }
  const validIds = new Set(facts.map(fact => fact.id));
  let rejected = 0;
  const claims = result.data.claims
    .filter(claim => {
      const hasInvalidCitation = claim.citations.some(
        citation => !validIds.has(citation)
      );
      const repeatedCitation =
        new Set(claim.citations).size !== claim.citations.length;
      const hasUnsupportedNumeral =
        /\d|%|\b(?:zero|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|cem|cento|mil|milh[aã]o|milh[õo]es)\b/i.test(
          claim.text
        ) ||
        /\b(?:um|uma)\s+(?:únic[oa]|apenas|total|segundo|primeir[oa]|dois?|casos?|dias?|horas?|eventos?|variantes?|recursos?|etapas?|atividades?|transições?)\b/i.test(
          claim.text
        );
      if (hasInvalidCitation || repeatedCitation || hasUnsupportedNumeral) {
        rejected += 1;
        return false;
      }
      return true;
    })
    .slice(0, 4);
  return {
    claims,
    rejected,
    message: claims.length
      ? undefined
      : "Todas as afirmações foram rejeitadas pelo gate de evidências.",
  };
}
