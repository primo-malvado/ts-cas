import type { Expr } from "../core/expr.js";
import { evaluate, type NumericBindings } from "../numeric/evaluate.js";

export interface GraphPoint { readonly x: number; readonly y: number | null; }
export interface GraphSample { readonly points: readonly GraphPoint[]; readonly xMin: number; readonly xMax: number; readonly finiteCount: number; }

/** Sample a real-valued expression for a graph. Invalid/domain points become null gaps. */
export function sampleFunction(
  expr: Expr,
  variable: string,
  xMin: number,
  xMax: number,
  samples = 501,
  bindings: NumericBindings = {},
): GraphSample {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) throw new RangeError("Graph range requires finite xMin < xMax.");
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 1_000_000) throw new RangeError("Sample count must be an integer from 2 to 1,000,000.");
  const dx = (xMax - xMin) / (samples - 1);
  let finiteCount = 0;
  const points = Array.from({ length: samples }, (_, index): GraphPoint => {
    const x = index === samples - 1 ? xMax : xMin + index * dx;
    try {
      const y = evaluate(expr, { ...bindings, [variable]: x });
      if (!Number.isFinite(y)) return { x, y: null };
      finiteCount++;
      return { x, y };
    } catch {
      return { x, y: null };
    }
  });
  return { points, xMin, xMax, finiteCount };
}
