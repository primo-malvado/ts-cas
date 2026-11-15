export type ApportionmentMethod = "dhondt" | "sainte-lague" | "hamilton";

export interface ApportionmentResult {
  readonly method: ApportionmentMethod;
  readonly seats: number;
  readonly allocation: Readonly<Record<string, number>>;
  readonly totalVotes: number;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
}

function validateVotes(votes: Readonly<Record<string, number>>, seats: number): [string, number][] {
  assertPositiveInteger(seats, "Seats");
  const entries = Object.entries(votes);
  if (entries.length === 0) throw new RangeError("At least one party or group is required.");
  if (entries.some(([name, count]) => !name || !Number.isSafeInteger(count) || count < 0)) {
    throw new RangeError("Names must be non-empty and votes must be non-negative integers.");
  }
  if (entries.every(([, count]) => count === 0)) throw new RangeError("At least one vote is required.");
  return entries;
}

/** Highest averages allocation; ties go to the earlier party in object insertion order. */
export function apportionSeats(
  votes: Readonly<Record<string, number>>,
  seats: number,
  method: "dhondt" | "sainte-lague" = "dhondt",
): ApportionmentResult {
  const entries = validateVotes(votes, seats);
  const allocation: Record<string, number> = Object.fromEntries(entries.map(([name]) => [name, 0]));
  const totalVotes = entries.reduce((sum, [, count]) => sum + count, 0);
  for (let seat = 0; seat < seats; seat++) {
    let bestName = entries[0]![0];
    let bestQuotient = -Infinity;
    for (const [name, count] of entries) {
      const currentSeats = allocation[name]!;
      const divisor = method === "dhondt" ? currentSeats + 1 : 2 * currentSeats + 1;
      const quotient = count / divisor;
      if (quotient > bestQuotient) {
        bestName = name;
        bestQuotient = quotient;
      }
    }
    allocation[bestName] = allocation[bestName]! + 1;
  }
  return { method, seats, allocation, totalVotes };
}

/** Largest-remainder (Hamilton) apportionment. Ties go to earlier parties in insertion order. */
export function hamiltonApportionment(
  votes: Readonly<Record<string, number>>,
  seats: number,
): ApportionmentResult {
  const entries = validateVotes(votes, seats);
  const totalVotes = entries.reduce((sum, [, count]) => sum + count, 0);
  const quota = totalVotes / seats;
  const allocation: Record<string, number> = {};
  const remainders: { name: string; remainder: number; index: number }[] = [];
  let allocated = 0;
  entries.forEach(([name, count], index) => {
    const exact = count / quota;
    const base = Math.floor(exact);
    allocation[name] = base;
    allocated += base;
    remainders.push({ name, remainder: exact - base, index });
  });
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < seats - allocated; i++) {
    const name = remainders[i]!.name;
    allocation[name] = allocation[name]! + 1;
  }
  return { method: "hamilton", seats, allocation, totalVotes };
}

export interface WeightedBallot {
  /** Candidates ordered from most preferred to least preferred. */
  readonly ranking: readonly string[];
  readonly weight?: number;
}

export interface ElectionResult {
  readonly scores: Readonly<Record<string, number>>;
  readonly winners: readonly string[];
}

function validateBallots(ballots: readonly WeightedBallot[], candidates: readonly string[]): void {
  if (candidates.length < 2 || new Set(candidates).size !== candidates.length || candidates.some(c => !c)) {
    throw new RangeError("At least two distinct, non-empty candidates are required.");
  }
  if (ballots.length === 0) throw new RangeError("At least one ballot is required.");
  const allowed = new Set(candidates);
  for (const ballot of ballots) {
    const weight = ballot.weight ?? 1;
    if (!Number.isSafeInteger(weight) || weight <= 0) throw new RangeError("Ballot weights must be positive integers.");
    if (ballot.ranking.length !== candidates.length || new Set(ballot.ranking).size !== candidates.length || ballot.ranking.some(c => !allowed.has(c))) {
      throw new RangeError("Each ballot must rank every candidate exactly once.");
    }
  }
}

function winners(scores: Readonly<Record<string, number>>, candidates: readonly string[]): string[] {
  const highest = Math.max(...candidates.map(name => scores[name]!));
  return candidates.filter(name => scores[name] === highest);
}

/** First-preference plurality for ranked ballots. */
export function pluralityElection(ballots: readonly WeightedBallot[], candidates: readonly string[]): ElectionResult {
  validateBallots(ballots, candidates);
  const scores: Record<string, number> = Object.fromEntries(candidates.map(candidate => [candidate, 0]));
  for (const ballot of ballots) {
    const candidate = ballot.ranking[0]!;
    scores[candidate] = scores[candidate]! + (ballot.weight ?? 1);
  }
  return { scores, winners: winners(scores, candidates) };
}

export interface MajorityResult {
  readonly totalVotes: number;
  readonly firstPreferenceVotes: Readonly<Record<string, number>>;
  readonly threshold: number;
  readonly winner: string | null;
}

/** Returns a winner only when one candidate receives strictly more than half of all first preferences. */
export function absoluteMajorityWinner(
  ballots: readonly WeightedBallot[],
  candidates: readonly string[],
): MajorityResult {
  validateBallots(ballots, candidates);
  const firstPreferenceVotes: Record<string, number> = Object.fromEntries(candidates.map(candidate => [candidate, 0]));
  for (const ballot of ballots) {
    const candidate = ballot.ranking[0]!;
    firstPreferenceVotes[candidate] = firstPreferenceVotes[candidate]! + (ballot.weight ?? 1);
  }
  const totalVotes = ballots.reduce((sum, ballot) => sum + (ballot.weight ?? 1), 0);
  const threshold = totalVotes / 2;
  const candidate = candidates.find(name => firstPreferenceVotes[name]! > threshold) ?? null;
  return { totalVotes, firstPreferenceVotes, threshold, winner: candidate };
}

/** Borda count: for N candidates a ranking awards N-1, N-2, ..., 0 points. */
export function bordaCount(ballots: readonly WeightedBallot[], candidates: readonly string[]): ElectionResult {
  validateBallots(ballots, candidates);
  const scores: Record<string, number> = Object.fromEntries(candidates.map(candidate => [candidate, 0]));
  for (const ballot of ballots) {
    const weight = ballot.weight ?? 1;
    ballot.ranking.forEach((candidate, rank) => {
      scores[candidate] = scores[candidate]! + (candidates.length - rank - 1) * weight;
    });
  }
  return { scores, winners: winners(scores, candidates) };
}

/** Returns the Condorcet winner, or null when no candidate beats every other candidate head-to-head. */
export function condorcetWinner(ballots: readonly WeightedBallot[], candidates: readonly string[]): string | null {
  validateBallots(ballots, candidates);
  const rankMaps = ballots.map(ballot => ({
    weight: ballot.weight ?? 1,
    rank: new Map(ballot.ranking.map((candidate, index) => [candidate, index])),
  }));
  for (const candidate of candidates) {
    let beatsEveryOther = true;
    for (const opponent of candidates) {
      if (candidate === opponent) continue;
      let candidateVotes = 0, opponentVotes = 0;
      for (const ballot of rankMaps) {
        if (ballot.rank.get(candidate)! < ballot.rank.get(opponent)!) candidateVotes += ballot.weight;
        else opponentVotes += ballot.weight;
      }
      if (candidateVotes <= opponentVotes) { beatsEveryOther = false; break; }
    }
    if (beatsEveryOther) return candidate;
  }
  return null;
}
