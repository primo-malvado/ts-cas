export interface SequencePoint { readonly index: number; readonly value: number; }

export function arithmeticSequence(first: number, difference: number, count: number): number[] {
  validateSequence(first, count);
  if (!Number.isFinite(difference)) throw new RangeError("Common difference must be finite.");
  return Array.from({ length: count }, (_, index) => first + index * difference);
}

export function geometricSequence(first: number, ratio: number, count: number): number[] {
  validateSequence(first, count);
  if (!Number.isFinite(ratio)) throw new RangeError("Common ratio must be finite.");
  return Array.from({ length: count }, (_, index) => first * ratio ** index);
}

/** Generate a recurrence sequence; initial terms are returned first, then next(previousTerms, index) is called. */
export function recurrenceSequence(
  initialTerms: readonly number[],
  count: number,
  next: (previousTerms: readonly number[], nextIndex: number) => number,
): number[] {
  if (initialTerms.length === 0) throw new RangeError("At least one initial term is required.");
  if (initialTerms.some(value => !Number.isFinite(value))) throw new RangeError("Initial terms must be finite.");
  if (!Number.isSafeInteger(count) || count < initialTerms.length || count > 1_000_000) throw new RangeError("Count must be an integer between the number of initial terms and 1,000,000.");
  const result = [...initialTerms];
  while (result.length < count) {
    const value = next(result.slice(), result.length);
    if (!Number.isFinite(value)) throw new RangeError(`Recurrence produced a non-finite value at index ${result.length}.`);
    result.push(value);
  }
  return result;
}

export function sequenceTable(values: readonly number[], firstIndex = 0): SequencePoint[] {
  if (!Number.isSafeInteger(firstIndex)) throw new RangeError("First index must be an integer.");
  if (values.some(value => !Number.isFinite(value))) throw new RangeError("Sequence values must be finite.");
  return values.map((value, index) => ({ index: firstIndex + index, value }));
}

function validateSequence(first: number, count: number): void {
  if (!Number.isFinite(first)) throw new RangeError("First term must be finite.");
  if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new RangeError("Count must be an integer between 0 and 1,000,000.");
}
