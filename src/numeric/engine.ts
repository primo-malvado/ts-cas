/**
 * Shared high-precision numerical engine.
 *
 * Configure precision and rounding once, then reuse one set of settings for
 * numeric evaluation, derivatives, finite integrals and polynomial roots.
 * Per-operation options can override the engine defaults without mutating them.
 */
import type { Expr } from "../core/expr.js";
import {
  decimal,
  decimalRound,
  evaluateDecimal,
  type BigDecimal,
  type DecimalBindings,
  type DecimalInput,
  type DecimalRoundingMode,
} from "./decimal.js";
import {
  evaluateComplexDecimal,
  type BigComplexDecimal,
  type ComplexDecimalBindings,
} from "./complex-decimal.js";
import {
  numericalDerivativeDecimal,
  integrateNumericallyDecimal,
  type DecimalDerivativeOptions,
  type DecimalDerivativeResult,
  type DecimalIntegralOptions,
  type DecimalNumericalIntegralResult,
} from "./calculus-decimal.js";
import {
  solvePolynomialNumericallyDecimal,
  type DecimalPolynomialRootsOptions,
  type DecimalPolynomialRootsResult,
} from "./polynomial-roots-decimal.js";
import {
  solveRootDecimal,
  type DecimalRootFindingOptions,
  type DecimalRootFindingResult,
} from "./root-finding-decimal.js";
import {
  evaluateDecimalInterval,
  type DecimalIntervalBindings,
  type DecimalIntervalEvaluationResult,
  type DecimalIntervalOptions,
} from "./interval.js";
import {
  certifyRealRoots,
  type CertifiedRootIsolationOptions,
  type CertifiedRootIsolationResult,
} from "./certified-roots.js";

export interface NumericalEngineOptions {
  /** Shared default precision in significant decimal digits. Default 50. */
  readonly precision?: number;
  /** Shared rounding mode. Default half-even. */
  readonly rounding?: DecimalRoundingMode;
  /** Operation-specific default absolute error targets. */
  readonly derivativeTolerance?: DecimalInput;
  readonly integrationTolerance?: DecimalInput;
  readonly rootTolerance?: DecimalInput;
  readonly maxIntegrationDepth?: number;
  readonly maxRootIterations?: number;
  readonly maxRootDegree?: number;
}

export interface NumericalEngineEvaluationOptions {
  readonly precision?: number;
  readonly rounding?: DecimalRoundingMode;
}

export interface NumericalEngineComplexEvaluationOptions extends NumericalEngineEvaluationOptions {}

export interface NumericalEngineDerivativeOptions extends DecimalDerivativeOptions {}
export interface NumericalEngineIntegralOptions extends DecimalIntegralOptions {}
export interface NumericalEngineRootOptions extends DecimalPolynomialRootsOptions {}
export interface NumericalEngineFunctionRootOptions extends DecimalRootFindingOptions {}
export interface NumericalEngineIntervalOptions extends DecimalIntervalOptions {}
export interface NumericalEngineCertifiedRootsOptions extends CertifiedRootIsolationOptions {}

export interface NumericalEngine {
  readonly precision: number;
  readonly rounding: DecimalRoundingMode;
  readonly settings: Readonly<Required<Pick<NumericalEngineOptions, "precision" | "rounding">> & NumericalEngineOptions>;
  evaluate(
    expression: Expr,
    bindings?: DecimalBindings,
    options?: NumericalEngineEvaluationOptions,
  ): BigDecimal;
  evaluateComplex(
    expression: Expr,
    bindings?: ComplexDecimalBindings,
    options?: NumericalEngineComplexEvaluationOptions,
  ): BigComplexDecimal;
  /** Certified outward-rounded interval evaluation for the supported real expression subset. */
  evaluateInterval(
    expression: Expr,
    bindings?: DecimalIntervalBindings,
    options?: NumericalEngineIntervalOptions,
  ): DecimalIntervalEvaluationResult;
  /** Certifies simple real roots for expressions supported by interval arithmetic. */
  certifyRoots(
    expression: Expr,
    variable: string,
    lower: DecimalInput,
    upper: DecimalInput,
    options?: NumericalEngineCertifiedRootsOptions,
  ): CertifiedRootIsolationResult;
  derivative(
    expression: Expr,
    variable: string,
    point: DecimalInput,
    bindings?: DecimalBindings,
    options?: NumericalEngineDerivativeOptions,
  ): DecimalDerivativeResult;
  integrate(
    expression: Expr,
    variable: string,
    lower: DecimalInput,
    upper: DecimalInput,
    bindings?: DecimalBindings,
    options?: NumericalEngineIntegralOptions,
  ): DecimalNumericalIntegralResult;
  solvePolynomial(
    expression: Expr,
    variable: string,
    options?: NumericalEngineRootOptions,
  ): DecimalPolynomialRootsResult;
  solveRoot(
    expression: Expr,
    variable: string,
    lower: DecimalInput,
    upper: DecimalInput,
    bindings?: DecimalBindings,
    options?: NumericalEngineFunctionRootOptions,
  ): DecimalRootFindingResult;
  configure(options: NumericalEngineOptions): NumericalEngine;
  withPrecision(precision: number): NumericalEngine;
  withRounding(rounding: DecimalRoundingMode): NumericalEngine;
}

function validatePrecision(precision: number): void {
  // decimalRound performs the canonical range validation used by the arithmetic module.
  decimalRound(decimal(1n), precision, "half-even");
}

function definedOptions<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** Creates an immutable facade with shared numeric precision and rounding settings. */
export function createNumericalEngine(options: NumericalEngineOptions = {}): NumericalEngine {
  const precision = options.precision ?? 50;
  const rounding = options.rounding ?? "half-even";
  validatePrecision(precision);
  // Validate rounding through the underlying decimal arithmetic implementation.
  decimalRound(decimal(1n), precision, rounding);
  if (options.derivativeTolerance !== undefined && decimal(options.derivativeTolerance).coefficient <= 0n) {
    throw new RangeError("derivativeTolerance must be positive.");
  }
  if (options.integrationTolerance !== undefined && decimal(options.integrationTolerance).coefficient <= 0n) {
    throw new RangeError("integrationTolerance must be positive.");
  }
  if (options.rootTolerance !== undefined && decimal(options.rootTolerance).coefficient <= 0n) {
    throw new RangeError("rootTolerance must be positive.");
  }

  const settings = Object.freeze({ ...options, precision, rounding });
  const engine: NumericalEngine = {
    precision,
    rounding,
    settings,

    evaluate(expression, bindings = {}, overrides = {}) {
      return evaluateDecimal(expression, bindings, {
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
      });
    },

    evaluateComplex(expression, bindings = {}, overrides = {}) {
      return evaluateComplexDecimal(expression, bindings, {
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
      });
    },

    evaluateInterval(expression, bindings = {}, overrides = {}) {
      // Interval arithmetic always rounds outwards; the engine's scalar rounding
      // mode is intentionally not applied to interval endpoints.
      return evaluateDecimalInterval(expression, bindings, {
        ...overrides,
        precision: overrides.precision ?? precision,
      });
    },

    certifyRoots(expression, variable, lower, upper, overrides = {}) {
      const merged = definedOptions({
        ...overrides,
        precision: overrides.precision ?? precision,
        tolerance: overrides.tolerance ?? settings.rootTolerance,
      }) as CertifiedRootIsolationOptions;
      return certifyRealRoots(expression, variable, lower, upper, merged);
    },

    derivative(expression, variable, point, bindings = {}, overrides = {}) {
      const merged = definedOptions({
        ...overrides,
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
        tolerance: overrides.tolerance ?? settings.derivativeTolerance,
      }) as DecimalDerivativeOptions;
      return numericalDerivativeDecimal(expression, variable, point, bindings, merged);
    },

    integrate(expression, variable, lower, upper, bindings = {}, overrides = {}) {
      const merged = definedOptions({
        ...overrides,
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
        tolerance: overrides.tolerance ?? settings.integrationTolerance,
        maxDepth: overrides.maxDepth ?? settings.maxIntegrationDepth,
      }) as DecimalIntegralOptions;
      return integrateNumericallyDecimal(expression, variable, lower, upper, bindings, merged);
    },

    solvePolynomial(expression, variable, overrides = {}) {
      const merged = definedOptions({
        ...overrides,
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
        tolerance: overrides.tolerance ?? settings.rootTolerance,
        maxIterations: overrides.maxIterations ?? settings.maxRootIterations,
        maxDegree: overrides.maxDegree ?? settings.maxRootDegree,
      }) as DecimalPolynomialRootsOptions;
      return solvePolynomialNumericallyDecimal(expression, variable, merged);
    },

    solveRoot(expression, variable, lower, upper, bindings = {}, overrides = {}) {
      const merged = definedOptions({
        ...overrides,
        precision: overrides.precision ?? precision,
        rounding: overrides.rounding ?? rounding,
        tolerance: overrides.tolerance ?? settings.rootTolerance,
        maxIterations: overrides.maxIterations ?? settings.maxRootIterations,
      }) as DecimalRootFindingOptions;
      return solveRootDecimal(expression, variable, lower, upper, bindings, merged);
    },

    configure(nextOptions) {
      return createNumericalEngine({ ...settings, ...nextOptions });
    },

    withPrecision(nextPrecision) {
      return createNumericalEngine({ ...settings, precision: nextPrecision });
    },

    withRounding(nextRounding) {
      return createNumericalEngine({ ...settings, rounding: nextRounding });
    },
  };
  return Object.freeze(engine);
}
