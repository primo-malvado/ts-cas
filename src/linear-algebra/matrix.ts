import { add, integer, isZero, mul, pow, type Expr } from "../core/expr.js";
import { simplify } from "../algebra/simplify.js";

export type Matrix = readonly (readonly Expr[])[];

export class MatrixError extends Error {
  constructor(message: string) { super(message); this.name = "MatrixError"; }
}

export interface MatrixShape { readonly rows: number; readonly columns: number; }

export function matrixShape(matrix: Matrix): MatrixShape {
  if (!Array.isArray(matrix) || matrix.length === 0) throw new MatrixError("A matrix must contain at least one row.");
  const columns = matrix[0]!.length;
  if (columns === 0) throw new MatrixError("A matrix must contain at least one column.");
  if (matrix.some(row => !Array.isArray(row) || row.length !== columns)) throw new MatrixError("Matrix rows must all have the same length.");
  return { rows: matrix.length, columns };
}

export function makeMatrix(rows: readonly (readonly Expr[])[]): Matrix {
  matrixShape(rows);
  return rows.map(row => [...row]);
}

export function identityMatrix(size: number): Matrix {
  assertPositiveInteger(size, "Matrix size");
  return Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => integer(i === j ? 1 : 0)));
}

export function matrixAdd(a: Matrix, b: Matrix): Matrix {
  const sa = matrixShape(a), sb = matrixShape(b);
  if (sa.rows !== sb.rows || sa.columns !== sb.columns) throw new MatrixError("Matrix addition requires matrices with the same dimensions.");
  return a.map((row, i) => row.map((value, j) => simplify(add(value, b[i]![j]!))));
}

export function matrixSubtract(a: Matrix, b: Matrix): Matrix {
  const sa = matrixShape(a), sb = matrixShape(b);
  if (sa.rows !== sb.rows || sa.columns !== sb.columns) throw new MatrixError("Matrix subtraction requires matrices with the same dimensions.");
  return a.map((row, i) => row.map((value, j) => simplify(add(value, mul(integer(-1), b[i]![j]!)))));
}

export function scalarMultiply(scalar: Expr, matrix: Matrix): Matrix {
  matrixShape(matrix);
  return matrix.map(row => row.map(value => simplify(mul(scalar, value))));
}

export function matrixMultiply(a: Matrix, b: Matrix): Matrix {
  const sa = matrixShape(a), sb = matrixShape(b);
  if (sa.columns !== sb.rows) throw new MatrixError("Matrix multiplication requires columns(A) = rows(B).");
  return Array.from({ length: sa.rows }, (_, i) =>
    Array.from({ length: sb.columns }, (_, j) =>
      simplify(add(...Array.from({ length: sa.columns }, (_, k) => mul(a[i]![k]!, b[k]![j]!))))));
}

export function transpose(matrix: Matrix): Matrix {
  const shape = matrixShape(matrix);
  return Array.from({ length: shape.columns }, (_, j) =>
    Array.from({ length: shape.rows }, (_, i) => matrix[i]![j]!));
}

export function trace(matrix: Matrix): Expr {
  const shape = matrixShape(matrix);
  if (shape.rows !== shape.columns) throw new MatrixError("Trace is defined only for square matrices.");
  return simplify(add(...matrix.map((row, i) => row[i]!)));
}

export function determinant(matrix: Matrix): Expr {
  const shape = matrixShape(matrix);
  if (shape.rows !== shape.columns) throw new MatrixError("Determinant is defined only for square matrices.");
  return determinantSquare(matrix);
}

function determinantSquare(matrix: Matrix): Expr {
  const n = matrix.length;
  if (n === 1) return matrix[0]![0]!;
  if (n === 2) return simplify(add(mul(matrix[0]![0]!, matrix[1]![1]!), mul(integer(-1), matrix[0]![1]!, matrix[1]![0]!)));
  const terms: Expr[] = [];
  for (let column = 0; column < n; column++) {
    const minor = matrix.slice(1).map(row => row.filter((_, j) => j !== column));
    const sign = column % 2 === 0 ? 1 : -1;
    terms.push(mul(integer(sign), matrix[0]![column]!, determinantSquare(minor)));
  }
  return simplify(add(...terms));
}

/** Reduced row-echelon form (RREF), using exact symbolic row operations where possible. */
export function rref(matrix: Matrix): Matrix {
  const shape = matrixShape(matrix);
  const a = matrix.map(row => row.map(value => simplify(value))) as Expr[][];
  let pivotRow = 0;
  for (let column = 0; column < shape.columns && pivotRow < shape.rows; column++) {
    let selected = pivotRow;
    while (selected < shape.rows && isZero(simplify(a[selected]![column]!))) selected++;
    if (selected === shape.rows) continue;
    if (selected !== pivotRow) [a[selected], a[pivotRow]] = [a[pivotRow]!, a[selected]!];
    const pivot = a[pivotRow]![column]!;
    for (let j = 0; j < shape.columns; j++) a[pivotRow]![j] = simplify(mul(a[pivotRow]![j]!, pow(pivot, integer(-1))));
    for (let i = 0; i < shape.rows; i++) {
      if (i === pivotRow) continue;
      const factor = a[i]![column]!;
      if (isZero(simplify(factor))) continue;
      for (let j = 0; j < shape.columns; j++) {
        a[i]![j] = simplify(add(a[i]![j]!, mul(integer(-1), factor, a[pivotRow]![j]!)));
      }
    }
    pivotRow++;
  }
  return a;
}

export function inverse(matrix: Matrix): Matrix {
  const shape = matrixShape(matrix);
  if (shape.rows !== shape.columns) throw new MatrixError("Only square matrices can be inverted.");
  const n = shape.rows;
  const augmented = matrix.map((row, i) => [...row, ...identityMatrix(n)[i]!]);
  const reduced = rref(augmented);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const expected = integer(i === j ? 1 : 0);
      if (!isZero(simplify(add(reduced[i]![j]!, mul(integer(-1), expected))))) {
        throw new MatrixError("Matrix is singular or its invertibility could not be established exactly.");
      }
    }
  }
  return reduced.map(row => row.slice(n));
}

export interface MatrixSolveResult {
  readonly status: "unique" | "infinite" | "none" | "unsupported";
  readonly solution?: readonly Expr[];
  readonly rank?: number;
}

/** Solve A*x=b for an exact linear system. The augmented matrix is [A | b]. */
export function solveMatrixSystem(coefficients: Matrix, rhs: readonly Expr[]): MatrixSolveResult {
  const shape = matrixShape(coefficients);
  if (rhs.length !== shape.rows) throw new MatrixError("Right-hand side length must equal the number of matrix rows.");
  const reduced = rref(coefficients.map((row, i) => [...row, rhs[i]! ]));
  const totalColumns = shape.columns + 1;
  const pivotColumns: number[] = [];
  for (let i = 0; i < reduced.length; i++) {
    const first = reduced[i]!.findIndex((value, j) => j < shape.columns && !isZero(simplify(value)));
    if (first >= 0 && !pivotColumns.includes(first)) pivotColumns.push(first);
    if (reduced[i]!.slice(0, shape.columns).every(value => isZero(simplify(value))) && !isZero(simplify(reduced[i]![shape.columns]!))) {
      return { status: "none", rank: pivotColumns.length };
    }
  }
  if (pivotColumns.length < shape.columns) return { status: "infinite", rank: pivotColumns.length };
  const solution = Array.from({ length: shape.columns }, () => integer(0) as Expr);
  for (let i = 0; i < reduced.length; i++) {
    const pivotColumn = reduced[i]!.findIndex((value, j) => j < shape.columns && !isZero(simplify(value)));
    if (pivotColumn >= 0) solution[pivotColumn] = simplify(reduced[i]![totalColumns - 1]!);
  }
  return { status: "unique", solution, rank: pivotColumns.length };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new MatrixError(`${label} must be a positive integer.`);
}
