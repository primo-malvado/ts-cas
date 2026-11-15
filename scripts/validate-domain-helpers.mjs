import assert from "node:assert/strict";
import * as cas from "../dist/src/index.js";

let passed = 0;
function check(name, action) {
  action();
  passed++;
  process.stdout.write(`✓ ${name}\n`);
}

check("quadratic inequality x² - 4 > 0", () => {
  const result = cas.solvePolynomialInequality(cas.parse("x^2 - 4"), "x", ">");
  assert.equal(result.status, "complete");
  assert.equal(result.intervals.length, 2);
  assert.equal(cas.toString(result.intervals[0].upper), "-2");
  assert.equal(cas.toString(result.intervals[1].lower), "2");
});
check("non-strict inequality includes both roots", () => {
  const result = cas.solvePolynomialInequality(cas.parse("x^2 - 4"), "x", "<=");
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].lowerClosed, true);
  assert.equal(result.intervals[0].upperClosed, true);
});
check("absolute-value inequality |x - 2| <= 3", () => {
  const result = cas.solveAbsoluteValueRelation(cas.parse("x - 2"), cas.parse("3"), "x", "<=");
  assert.equal(result.status, "complete");
  assert.equal(cas.toString(result.intervals[0].lower), "-1");
  assert.equal(cas.toString(result.intervals[0].upper), "5");
});
check("cube root works for negative numbers", () => {
  assert.equal(cas.evaluate(cas.parse("cbrt(-8)")), -2);
  assert.equal(cas.decimalToString(cas.evaluateDecimal(cas.parse("cbrt(-8)"), {}, { precision: 30 })), "-2");
});
check("cube-root interval is enclosed", () => {
  const result = cas.evaluateDecimalInterval(cas.parse("cbrt(x)"), { x: cas.decimalInterval("-8", "27") }, { precision: 30 });
  assert.equal(result.certified, true);
  assert.equal(result.lowerText, "-2");
  assert.equal(result.upperText, "3");
});
check("compound interest", () => {
  assert.ok(Math.abs(cas.compoundInterestAmount(1000, 0.05, 2) - 1102.5) < 1e-9);
});
check("D'Hondt allocation", () => {
  assert.deepEqual(cas.apportionSeats({ A: 1000, B: 700, C: 300 }, 5, "dhondt").allocation, { A: 3, B: 2, C: 0 });
});
check("Sainte-Laguë allocation", () => {
  assert.deepEqual(cas.apportionSeats({ A: 1000, B: 700, C: 300 }, 5, "sainte-lague").allocation, { A: 2, B: 2, C: 1 });
});
check("Hamilton allocation conserves seats", () => {
  const allocation = cas.hamiltonApportionment({ A: 1000, B: 700, C: 300 }, 5).allocation;
  assert.equal(Object.values(allocation).reduce((sum, value) => sum + value, 0), 5);
});
check("Borda and Condorcet", () => {
  const candidates = ["Ana", "Bruno", "Carla"];
  const ballots = [
    { ranking: ["Ana", "Bruno", "Carla"], weight: 3 },
    { ranking: ["Bruno", "Ana", "Carla"], weight: 2 },
    { ranking: ["Carla", "Ana", "Bruno"], weight: 1 },
  ];
  assert.equal(cas.bordaCount(ballots, candidates).scores.Ana, 9);
  assert.equal(cas.condorcetWinner(ballots, candidates), "Ana");
});
check("descriptive statistics and quartiles", () => {
  const summary = cas.describeQuantitativeData([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(summary.mean, 4);
  assert.equal(summary.firstQuartile, 2);
  assert.equal(summary.median, 4);
  assert.equal(summary.thirdQuartile, 6);
});
check("frequency table has cumulative counts", () => {
  const rows = cas.frequencyTable([1, 2, 2, 3]);
  assert.deepEqual(rows.map(row => row.cumulativeFrequency), [1, 3, 4]);
});
check("triangle analysis using Heron's formula", () => {
  const triangle = cas.analyzeTriangle(3, 4, 5);
  assert.equal(triangle.angleType, "right");
  assert.ok(Math.abs(triangle.area - 6) < 1e-12);
});
check("line intersection in the plane", () => {
  const a = cas.lineThroughPoints2D({ x: 0, y: 2 }, { x: 4, y: 2 });
  const b = cas.lineThroughPoints2D({ x: 1, y: -1 }, { x: 1, y: 5 });
  assert.deepEqual(cas.intersectLines2D(a, b), { kind: "point", point: { x: 1, y: 2 } });
});
check("distance from a point to a plane", () => {
  const plane = cas.planeThroughPointNormal({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(cas.distancePointPlane3D({ x: 1, y: 2, z: 5 }, plane) - 3) < 1e-12);
});
check("piecewise function evaluation", () => {
  const branches = [
    { lower: null, upper: 0, upperClosed: false, expression: cas.parse("-x") },
    { lower: 0, lowerClosed: true, upper: null, expression: cas.parse("x^2") },
  ];
  assert.equal(cas.evaluatePiecewiseFunction(branches, "x", -2), 2);
  assert.equal(cas.evaluatePiecewiseFunction(branches, "x", 3), 9);
});
check("piecewise equation solving", () => {
  const result = cas.solvePiecewiseEquation([
    { lower: null, upper: 0, upperClosed: false, expression: cas.parse("x + 1") },
    { lower: 0, lowerClosed: true, upper: null, expression: cas.parse("x - 2") },
  ], "x");
  assert.deepEqual(result.roots.map(root => root.approximation), [-1, 2]);
});
check("existing symbolic equation solver", () => {
  const result = cas.solve(cas.parse("x^2 - 5*x + 6"), "x");
  assert.equal(result.status, "finite");
  assert.equal(result.solutions.length, 2);
});
check("domain helpers are exposed from the package root", () => {
  assert.equal(typeof cas.compoundInterestAmount, "function");
  assert.equal(typeof cas.distance3D, "function");
  assert.equal(typeof cas.apportionSeats, "function");
  assert.equal(typeof cas.solveLineParabolaParameter, "function");
});

process.stdout.write(`\n${passed} domain-helper smoke checks passed.\n`);
