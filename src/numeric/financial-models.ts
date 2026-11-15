/** Numeric models for interest, inflation, and loan payments. */

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number.`);
}
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
}

/** Simple-interest amount: A = P(1 + r t). Rate r is a decimal, e.g. 0.04 for 4%. */
export function simpleInterestAmount(principal: number, annualRate: number, years: number): number {
  assertFiniteNonNegative(principal, "Principal");
  assertFiniteNonNegative(annualRate, "Annual rate");
  assertFiniteNonNegative(years, "Years");
  return assertFiniteResult(principal * (1 + annualRate * years), "Simple-interest amount");
}

/** Compound amount: A = P(1 + r/m)^(m t). Rate r is nominal annual rate as a decimal. */
export function compoundInterestAmount(
  principal: number,
  nominalAnnualRate: number,
  years: number,
  compoundsPerYear = 1,
): number {
  assertFiniteNonNegative(principal, "Principal");
  assertFiniteNonNegative(nominalAnnualRate, "Nominal annual rate");
  assertFiniteNonNegative(years, "Years");
  assertPositiveInteger(compoundsPerYear, "Compounds per year");
  return assertFiniteResult(principal * (1 + nominalAnnualRate / compoundsPerYear) ** (compoundsPerYear * years), "Compound-interest amount");
}

/** Effective annual rate for nominal annual rate r convertible m times per year. */
export function effectiveAnnualRate(nominalAnnualRate: number, compoundsPerYear = 1): number {
  assertFiniteNonNegative(nominalAnnualRate, "Nominal annual rate");
  assertPositiveInteger(compoundsPerYear, "Compounds per year");
  return assertFiniteResult((1 + nominalAnnualRate / compoundsPerYear) ** compoundsPerYear - 1, "Effective annual rate");
}

/** Purchasing-power value today of an amount after inflation compounded for `years`. */
export function inflationAdjustedValue(futureAmount: number, annualInflationRate: number, years: number): number {
  assertFiniteNonNegative(futureAmount, "Future amount");
  if (!Number.isFinite(annualInflationRate) || annualInflationRate <= -1) {
    throw new RangeError("Annual inflation rate must be finite and greater than -100%.");
  }
  assertFiniteNonNegative(years, "Years");
  return assertFiniteResult(futureAmount / (1 + annualInflationRate) ** years, "Inflation-adjusted value");
}

/** Constant instalment for an annuity-immediate loan. Rate is per payment period. */
export function loanPayment(principal: number, periodicRate: number, numberOfPayments: number): number {
  assertFiniteNonNegative(principal, "Principal");
  if (!Number.isFinite(periodicRate) || periodicRate < 0) throw new RangeError("Periodic rate must be finite and non-negative.");
  assertPositiveInteger(numberOfPayments, "Number of payments");
  if (periodicRate === 0) return principal / numberOfPayments;
  const growth = (1 + periodicRate) ** numberOfPayments;
  return assertFiniteResult(principal * periodicRate * growth / (growth - 1), "Loan payment");
}


function assertFiniteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} overflowed the available numeric range.`);
  return value;
}
