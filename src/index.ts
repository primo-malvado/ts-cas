export * from "./core/expr.js";
export {
  verifyCertificate,
  type CertificateKind,
  type CertificateVerificationContext,
  type CertificateVerificationResult,
} from "./certificates.js";
export {
  differentiateWithProof,
  factorWithProof,
  integrateWithProof,
  solveWithProof,
  verifyProofCarryingResult,
  type ProofCarryingCalculation,
  type ProofCarryingCreationResult,
  type ProofCarryingVerificationResult,
  type SerializableProofStep,
  type SerializedDomainCondition,
} from "./proof-carrying.js";
export {
  toLearningExplanation,
  type LearningExplanation,
  type LearningStep,
} from "./learning-explanations.js";
export { parse } from "./core/parser.js";
export { parseWithDomain } from "./algebra/parse-with-domain.js";
export { toString } from "./core/printer.js";
export { simplify } from "./algebra/simplify.js";
export {
  simplifyWithDomain,
  type DomainRelation,
  type DomainCondition,
  type DomainSimplificationStatus,
  type DomainSimplificationResult,
} from "./algebra/simplify-with-domain.js";
export {
  combineWithDomain,
  transformWithDomain,
  substituteWithDomain,
  differentiateWithDomain,
  expandWithDomain,
  factorWithDomain,
  integrateWithDomain,
  evaluateWithDomain,
  limitWithDomain,
  seriesWithDomain,
  taylorSeriesWithDomain,
  laurentSeriesWithDomain,
  analyzeContinuityWithDomain,
  solveWithDomain,
  solvePolynomialSystemWithDomain,
  type DomainExpressionTransform,
  type DomainExpressionCombine,
  type DomainEquationSolveResult,
  type DomainPolynomialEquation,
  type DomainPolynomialSystemSolveResult,
  type DomainEvaluationResult,
  type DomainPointStatus,
  type DomainLimitResult,
  type DomainSeriesResult,
  type DomainContinuityResult,
} from "./algebra/domain-aware-operations.js";
export { polynomialCoefficientsIn } from "./algebra/symbolic-polynomial.js";
export { substitute } from "./algebra/substitute.js";
export { expand } from "./algebra/expand.js";
export {
  differentiate,
  differentiateWithSteps,
  verifyDifferentiationExplanation,
  type DifferentiationRule,
  type DifferentiationStep,
  type DifferentiationResult,
  type DifferentiationVerificationResult,
} from "./calculus/differentiate.js";
export {
  integrate, integrateWithSteps, verifyIntegrationExplanation, IntegrationError,
  type IntegrationRule, type IntegrationStep, type IntegrationExplanation, type IntegrationVerificationResult,
} from "./calculus/integrate.js";
export {
  createAntiderivativeCertificate,
  verifyAntiderivativeCertificate,
  type AntiderivativeCertificate,
  type AntiderivativeCertificateCreationResult,
  type AntiderivativeCertificateVerificationResult,
} from "./calculus/antiderivative-certificates.js";

export {
  polynomialZero, polynomialConstant, polynomialVariable, polynomialFromExpr, polynomialToExpr,
  polynomialAdd, polynomialNegate, polynomialSubtract, polynomialMultiply, polynomialPow,
  polynomialDegree, polynomialCoefficient, polynomialEvaluate, polynomialDivide, isUnivariatePolynomial,
  type Polynomial, type PolynomialTerm, type Monomial,
} from "./algebra/polynomial.js";

export {
  factor, factorWithSteps, factorPolynomial, verifyFactorizationExplanation,
  type Factorization, type PolynomialFactor, type FactorizationStepRule,
  type FactorizationStep, type FactorizationExplanation, type FactorizationVerificationResult,
} from "./algebra/factor.js";

export {
  solve,
  solveEquation,
  solveWithCertificates,
  solveWithSteps,
  verifyEquationSolveExplanation,
  type EquationSolution,
  type CertifiedEquationSolution,
  type EquationSolveStatus,
  type EquationSolveRule,
  type EquationSolveStep,
  type EquationSolveExplanation,
  type EquationSolveVerificationResult,
} from "./algebra/solve.js";

export { simplifyRadicals } from "./algebra/radicals.js";
export { complex, complexAdd, complexSubtract, complexMultiply, complexDivide, complexConjugate, complexIsReal, type ExactComplex } from "./algebra/complex.js";

export {
  solveLinearSystem, solvePolynomialSystem,
  type LinearEquation, type PolynomialEquation, type LinearSystemResult, type PolynomialSystemResult,
} from "./algebra/system.js";
export {
  createLinearSystemCertificate,
  verifyLinearSystemCertificate,
  type CertificateRational,
  type LinearSystemCertificate,
  type LinearSystemCertificateCreationResult,
  type LinearSystemCertificateVerificationResult,
} from "./algebra/linear-system-certificates.js";
export {
  createPolynomialSystemWitnessCertificate,
  verifyPolynomialSystemWitnessCertificate,
  createPolynomialSystemCompletenessCertificate,
  verifyPolynomialSystemCompletenessCertificate,
  type SerializedExactExpression,
  type PolynomialSystemWitnessCertificate,
  type PolynomialSystemWitnessCreationResult,
  type PolynomialSystemWitnessVerificationResult,
  type PolynomialSystemCompletenessCertificate,
  type PolynomialSystemCompletenessCreationResult,
  type PolynomialSystemCompletenessVerificationResult,
} from "./algebra/polynomial-system-certificates.js";

export { simplifyRational, type RationalSimplificationResult, type RationalSimplificationStatus } from "./algebra/rational.js";
export {
  limit, type LimitPoint, type LimitDirection, type LimitStatus, type LimitMethod, type LimitResult,
} from "./calculus/limit.js";
export {
  analyzeContinuity,
  type ContinuityAnalysisStatus,
  type ContinuityClassification,
  type PointDomainStatus,
  type SideDomainStatus,
  type ContinuityAnalysisOptions,
  type ContinuityAnalysisResult,
} from "./calculus/continuity.js";

export {
  series, taylorSeries, laurentSeries, SeriesError,
  type SeriesResult, type SeriesKind,
} from "./calculus/series.js";

// Numeric evaluation and the NumWorks-style numerical/statistical toolset.
export { evaluate, type NumericBindings } from "./numeric/evaluate.js";
export {
  mean, median, variance, standardDeviation, quantile, mode, covariance,
  correlation, linearRegression, histogram,
  type LinearRegressionResult, type HistogramBin,
} from "./numeric/statistics.js";
export {
  factorial, permutations, combinations, binomialPmf, binomialCdf,
  normalPdf, normalCdf,
} from "./numeric/probability.js";

// Exact-expression linear algebra.
export {
  matrixShape, makeMatrix, identityMatrix, matrixAdd, matrixSubtract, scalarMultiply,
  matrixMultiply, transpose, trace, determinant, rref, inverse, solveMatrixSystem,
  MatrixError,
  type Matrix, type MatrixShape, type MatrixSolveResult,
} from "./linear-algebra/matrix.js";

// Graphing backend: expression sampling, with null gaps at singularities.
export { sampleFunction, type GraphPoint, type GraphSample } from "./graph/sampling.js";

export {
  numericalDerivative, solveRootBisection, solveRootNewton, solveRootHybrid, integrateNumerically,
  type RootResult, type NumericIntegralResult,
} from "./numeric/calculus.js";
export {
  arithmeticSequence, geometricSequence, recurrenceSequence, sequenceTable,
  type SequencePoint,
} from "./numeric/sequences.js";


// Numerical complex arithmetic and evaluation (IEEE-754 double precision).
export {
  numericComplex, numericComplexAdd, numericComplexSubtract, numericComplexMultiply,
  numericComplexDivide, numericComplexConjugate, numericComplexAbs, numericComplexExp,
  numericComplexLog, numericComplexSqrt, numericComplexSin, numericComplexCos,
  numericComplexTan, numericComplexPow, numericComplexAtan, evaluateComplex,
  type NumericComplex, type NumericComplexValue, type NumericComplexBindings,
} from "./numeric/complex.js";

// Numerical isolation of all distinct real roots of univariate polynomials.
export {
  solvePolynomialNumerically,
  type NumericPolynomialRoot, type NumericPolynomialRootsResult,
  type NumericPolynomialRootStatus, type NumericPolynomialRootsOptions, type PolynomialRootMethod,
} from "./numeric/polynomial-roots.js";


// Arbitrary-precision real decimal arithmetic and expression evaluation (BigInt-backed).
export {
  decimal, parseDecimal, decimalPowerOfTen, decimalToString, decimalToScientificString,
  decimalToNumber, decimalRound, decimalNegate, decimalAbs, decimalCompare, decimalAdd,
  decimalSubtract, decimalMultiply, decimalDivide, decimalPowInteger, decimalPow,
  decimalSqrt, decimalCbrt, decimalLn, decimalExp, decimalPi, decimalAtan, decimalSin, decimalCos,
  decimalTan, evaluateDecimal,
  type BigDecimal, type DecimalInput, type DecimalContext, type DecimalBindings,
  type DecimalRoundingMode,
} from "./numeric/decimal.js";


// Arbitrary-precision polynomial root isolation.
export {
  solvePolynomialNumericallyDecimal,
  type DecimalPolynomialRootMethod,
  type DecimalPolynomialRoot,
  type DecimalPolynomialRootStatus,
  type DecimalPolynomialRootsResult,
  type DecimalPolynomialRootsOptions,
} from "./numeric/polynomial-roots-decimal.js";

// Arbitrary-precision numerical differentiation and integration.
export {
  numericalDerivativeDecimal,
  integrateNumericallyDecimal,
  type DecimalDerivativeMethod,
  type DecimalNumericalOptions,
  type DecimalDerivativeOptions,
  type DecimalDerivativeResult,
  type DecimalIntegralOptions,
  type DecimalNumericalIntegralResult,
} from "./numeric/calculus-decimal.js";


// Unified precision-configurable numeric engine.
export {
  createNumericalEngine,
  type NumericalEngine,
  type NumericalEngineOptions,
  type NumericalEngineEvaluationOptions,
  type NumericalEngineComplexEvaluationOptions,
  type NumericalEngineDerivativeOptions,
  type NumericalEngineIntegralOptions,
  type NumericalEngineRootOptions,
  type NumericalEngineFunctionRootOptions,
} from "./numeric/engine.js";


// Arbitrary-precision bracketing root finding for general real expressions.
export {
  solveRootDecimal,
  type DecimalRootFindingStatus,
  type DecimalRootFindingOptions,
  type DecimalRootFindingResult,
} from "./numeric/root-finding-decimal.js";



// Arbitrary-precision complex arithmetic and principal-branch evaluation.
export {
  complexDecimal, complexDecimalAdd, complexDecimalSubtract, complexDecimalNegate,
  complexDecimalConjugate, complexDecimalMultiply, complexDecimalDivide, complexDecimalAbs,
  complexDecimalExp, complexDecimalArg, complexDecimalLog, complexDecimalLn, complexDecimalSqrt,
  complexDecimalSin, complexDecimalCos, complexDecimalTan, complexDecimalAtan, complexDecimalPow,
  evaluateComplexDecimal, complexDecimalToString,
  type BigComplexDecimal, type ComplexDecimalInput, type ComplexDecimalBindings,
} from "./numeric/complex-decimal.js";


// Shared numeric-engine interface includes precision-configured complex evaluation.


// Outward-rounded interval arithmetic. Certification is limited to the documented
// algebraic/real-function subset; transcendental functions are rejected explicitly.
export {
  decimalInterval,
  asDecimalInterval,
  decimalIntervalContains,
  decimalIntervalContainsZero,
  decimalIntervalWidth,
  decimalIntervalAdd,
  decimalIntervalNegate,
  decimalIntervalSubtract,
  decimalIntervalMultiply,
  decimalIntervalDivide,
  decimalIntervalPowInteger,
  decimalIntervalSqrt,
  decimalIntervalCbrt,
  decimalIntervalAbs,
  evaluateDecimalInterval,
  decimalIntervalToString,
  type DecimalInterval,
  type DecimalIntervalInput,
  type DecimalIntervalBindings,
  type DecimalIntervalOptions,
  type DecimalIntervalEvaluationResult,
} from "./numeric/interval.js";
export type { NumericalEngineIntervalOptions } from "./numeric/engine.js";


// Certified interval-based isolation for simple real roots.
export {
  certifyRealRoots,
  type CertifiedRootIsolationStatus,
  type CertifiedRootBracket,
  type UnresolvedRootRegion,
  type CertifiedRootIsolationOptions,
  type CertifiedRootIsolationResult,
} from "./numeric/certified-roots.js";
export type { NumericalEngineCertifiedRootsOptions } from "./numeric/engine.js";


// Certified interval extensions for exp and ln/log.
export {
  decimalIntervalExp,
  decimalIntervalLn,
} from "./numeric/interval.js";


// Certified trigonometric interval extensions with certified argument reduction.
export {
  decimalIntervalSin,
  decimalIntervalCos,
  decimalIntervalTan,
} from "./numeric/interval.js";

// Certified interval for pi, used by trigonometric argument reduction.
export { decimalIntervalPi } from "./numeric/interval.js";


// Exact rational polynomial root isolation with Sturm sequences, including multiplicities.
export {
  exactRational,
  exactRationalFromDecimalParts,
  exactRationalToString,
  isolateRealRootsExact,
  isolateRealRootsExactInInterval,
  type ExactRational,
  type ExactRootInterval,
  type ExactUnresolvedRootInterval,
  type ExactRootIsolationResult,
} from "./numeric/sturm.js";
export {
  createPolynomialRootCertificate,
  verifyPolynomialRootCertificate,
  type PolynomialRootCertificate,
  type PolynomialRootCertificateOptions,
  type PolynomialRootCertificateCreationResult,
  type PolynomialRootCertificateVerificationResult,
} from "./numeric/root-certificates.js";
export {
  createPolynomialInequalityCertificate,
  verifyPolynomialInequalityCertificate,
  type CertifiedInequalityCell,
  type CertifiedPolynomialInequality,
  type CertifiedPolynomialInequalityResult,
  type InequalityCertificateVerificationResult,
} from "./numeric/inequality-certificates.js";

// Exact rational-domain analysis: certified holes and poles on a real interval.
export {
  analyzeRationalSingularities,
  type RationalSingularityKind,
  type RationalDomainAnalysisStatus,
  type RationalDomainAnalysisOptions,
  type RationalSingularity,
  type RationalDomainAnalysisResult,
} from "./algebra/domain.js";


// Certified analysis of real-domain restrictions for elementary expressions.
export {
  analyzeRealDomain,
  type RealDomainRestrictionKind,
  type RealDomainCondition,
  type RealDomainAnalysisStatus,
  type RealDomainConditionState,
  type RealDomainAnalysisOptions,
  type ExactDomainBoundary,
  type UnresolvedDomainBoundary,
  type CertifiedDecimalDomainBoundary,
  type RealDomainBoundary,
  type RealDomainRegion,
  type RealDomainGlobalState,
  type RealDomainGlobalRegion,
  type RealDomainRestriction,
  type RealDomainAnalysisResult,
} from "./algebra/real-domain.js";

// Domain-specific mathematical helpers.
export {
  solvePolynomialInequality,
  solveAbsoluteValueRelation,
  type InequalityRelation,
  type InequalityStatus,
  type InequalityInterval,
  type PolynomialInequalityResult,
} from "./algebra/inequalities.js";
export {
  simpleInterestAmount,
  compoundInterestAmount,
  effectiveAnnualRate,
  inflationAdjustedValue,
  loanPayment,
} from "./numeric/financial-models.js";
export {
  apportionSeats,
  hamiltonApportionment,
  pluralityElection,
  absoluteMajorityWinner,
  bordaCount,
  condorcetWinner,
  type ApportionmentMethod,
  type ApportionmentResult,
  type WeightedBallot,
  type ElectionResult,
  type MajorityResult,
} from "./numeric/elections.js";
export {
  distance2D,
  midpoint2D,
  vectorFromPoints2D,
  dot2D,
  norm2D,
  slope2D,
  lineThroughPoints2D,
  distancePointLine2D,
  intersectLines2D,
  circle2D,
  pointCircleRelation,
  circleEquationCoefficients,
  distance3D,
  midpoint3D,
  vectorFromPoints3D,
  dot3D,
  norm3D,
  cross3D,
  angleBetweenVectors2D,
  angleBetweenVectors3D,
  arePerpendicular2D,
  arePerpendicular3D,
  line3D,
  distancePointLine3D,
  planeThroughPointNormal,
  distancePointPlane3D,
  sphere3D,
  analyzeTriangle,
  pythagoreanHypotenuse,
  circleArea,
  circleCircumference,
  type Point2D,
  type Point3D,
  type Vector2D,
  type Vector3D,
  type Line2D,
  type Circle2D,
  type Sphere3D,
  type Plane3D,
  type Line3D,
  type LineIntersection2D,
  type TriangleAnalysis,
  type TriangleKind,
  type TriangleAngleType,
} from "./geometry/geometry.js";
export {
  frequencyTable,
  describeQuantitativeData,
  type FrequencyRow,
  type DescriptiveStatistics,
} from "./numeric/descriptive-statistics.js";
export {
  evaluatePiecewiseFunction,
  samplePiecewiseFunction,
  solvePiecewiseEquation,
  type PiecewiseBranch,
  type PiecewiseRoot,
  type PiecewiseEquationResult,
  type PiecewiseSample,
} from "./graph/piecewise.js";

// Step-by-step solvers for common analytic-geometry parameter problems.
export {
  solveLineParabolaParameter,
  solveLineParabolaExpressions,
  rationalCoefficientSign,
  type IntersectionCondition,
  type MathSolutionStep,
  type LineParabolaParameterResult,
} from "./geometry/analytic-problems.js";
