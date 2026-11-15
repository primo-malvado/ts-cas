import { describe, expect, it } from "vitest";
import { determinant, inverse, matrixAdd, matrixMultiply, parse, solveMatrixSystem, toString, trace, transpose } from "../src/index.js";

const m = (rows: string[][]) => rows.map(row => row.map(parse));

describe("matrix algebra", () => {
  it("adds, multiplies and transposes matrices", () => {
    expect(matrixAdd(m([["1", "2"], ["3", "4"]]), m([["1", "0"], ["0", "1"]])).map(r => r.map(value => toString(value))))
      .toEqual([["2", "2"], ["3", "5"]]);
    expect(matrixMultiply(m([["1", "2"], ["3", "4"]]), m([["2"], ["1"]])).map(r => r.map(value => toString(value))))
      .toEqual([["4"], ["10"]]);
    expect(transpose(m([["1", "2", "3"], ["4", "5", "6"]])).map(r => r.map(value => toString(value))))
      .toEqual([["1", "4"], ["2", "5"], ["3", "6"]]);
  });
  it("computes determinant, trace and inverse exactly", () => {
    const matrix = m([["1", "2"], ["3", "4"]]);
    expect(toString(determinant(matrix))).toBe("-2");
    expect(toString(trace(matrix))).toBe("5");
    expect(inverse(matrix).map(r => r.map(value => toString(value)))).toEqual([["-2", "1"], ["3/2", "-1/2"]]);
  });
  it("solves exact linear systems and identifies non-unique solutions", () => {
    const unique = solveMatrixSystem(m([["1", "2"], ["3", "4"]]), [parse("5"), parse("11")]);
    expect(unique.status).toBe("unique");
    expect(unique.solution!.map(value => toString(value))).toEqual(["1", "2"]);
    expect(solveMatrixSystem(m([["1", "1"], ["2", "2"]]), [parse("2"), parse("4")]).status).toBe("infinite");
    expect(solveMatrixSystem(m([["1", "1"], ["2", "2"]]), [parse("2"), parse("5")]).status).toBe("none");
  });

});
