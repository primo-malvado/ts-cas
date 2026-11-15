import { parsePreservingStructure } from "../core/parser.js";
import { simplifyWithDomain, type DomainSimplificationResult } from "./simplify-with-domain.js";

/** Parse an expression while retaining restrictions hidden by canonical simplification. */
export function parseWithDomain(source: string): DomainSimplificationResult {
  return simplifyWithDomain(parsePreservingStructure(source));
}
