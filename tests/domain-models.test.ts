import { describe, expect, it } from "vitest";
import {
  absoluteMajorityWinner, apportionSeats, bordaCount, compoundInterestAmount, condorcetWinner,
  effectiveAnnualRate, hamiltonApportionment, inflationAdjustedValue,
  loanPayment, pluralityElection, simpleInterestAmount,
} from "../src/index.js";

describe("election, apportionment, and finance models", () => {
  it("calculates simple and compound interest consistently", () => {
    expect(simpleInterestAmount(1000, 0.05, 2)).toBeCloseTo(1100, 10);
    expect(compoundInterestAmount(1000, 0.05, 2)).toBeCloseTo(1102.5, 10);
    expect(effectiveAnnualRate(0.12, 12)).toBeCloseTo((1.01 ** 12) - 1, 12);
    expect(inflationAdjustedValue(121, 0.1, 2)).toBeCloseTo(100, 10);
    expect(loanPayment(1200, 0, 12)).toBe(100);
    expect(loanPayment(1200, 0.01, 12)).toBeGreaterThan(100);
  });

  it("allocates seats using D'Hondt, Sainte-Laguë, and Hamilton methods", () => {
    const votes = { A: 1000, B: 700, C: 300 };
    expect(apportionSeats(votes, 5, "dhondt").allocation).toEqual({ A: 3, B: 2, C: 0 });
    expect(apportionSeats(votes, 5, "sainte-lague").allocation).toEqual({ A: 2, B: 2, C: 1 });
    const hamilton = hamiltonApportionment(votes, 5);
    expect(Object.values(hamilton.allocation).reduce((a, b) => a + b, 0)).toBe(5);
    expect(hamilton.allocation).toEqual({ A: 2, B: 2, C: 1 });
  });

  it("counts plurality and Borda ballots and identifies a Condorcet winner", () => {
    const candidates = ["Ana", "Bruno", "Carla"];
    const ballots = [
      { ranking: ["Ana", "Bruno", "Carla"], weight: 3 },
      { ranking: ["Bruno", "Ana", "Carla"], weight: 2 },
      { ranking: ["Carla", "Ana", "Bruno"], weight: 1 },
    ];
    expect(pluralityElection(ballots, candidates).winners).toEqual(["Ana"]);
    expect(absoluteMajorityWinner(ballots, candidates).winner).toBeNull();
    expect(absoluteMajorityWinner([{ ...ballots[0]!, weight: 4 }, ...ballots.slice(1)], candidates).winner).toBe("Ana");
    expect(bordaCount(ballots, candidates).scores).toEqual({ Ana: 9, Bruno: 7, Carla: 2 });
    expect(condorcetWinner(ballots, candidates)).toBe("Ana");
  });
});
