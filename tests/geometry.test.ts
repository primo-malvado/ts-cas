import { describe, expect, it } from "vitest";
import {
  analyzeTriangle, angleBetweenVectors3D, arePerpendicular3D, circleArea, circleCircumference, circle2D,
  circleEquationCoefficients, distance2D, distance3D, distancePointLine2D, distancePointLine3D,
  distancePointPlane3D, intersectLines2D, line3D, lineThroughPoints2D, midpoint2D, midpoint3D,
  planeThroughPointNormal, pointCircleRelation, pythagoreanHypotenuse, sphere3D,
} from "../src/index.js";

describe("plane and solid geometry", () => {
  it("computes point distances, midpoints, and line equations", () => {
    expect(distance2D({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(midpoint2D({ x: -2, y: 4 }, { x: 4, y: 8 })).toEqual({ x: 1, y: 6 });
    const horizontal = lineThroughPoints2D({ x: 0, y: 2 }, { x: 4, y: 2 });
    expect(distancePointLine2D({ x: 0, y: 5 }, horizontal)).toBeCloseTo(3, 12);
    const vertical = lineThroughPoints2D({ x: 1, y: -1 }, { x: 1, y: 5 });
    expect(intersectLines2D(horizontal, vertical)).toMatchObject({ kind: "point", point: { x: 1, y: 2 } });
    expect(intersectLines2D(horizontal, lineThroughPoints2D({ x: 0, y: 3 }, { x: 2, y: 3 })).kind).toBe("parallel");
  });

  it("supports 3D midpoint and distance", () => {
    expect(midpoint3D({ x: 0, y: 2, z: 4 }, { x: 2, y: 4, z: 6 })).toEqual({ x: 1, y: 3, z: 5 });
    expect(distance3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBe(3);
    expect(sphere3D({ x: 1, y: 2, z: 3 }, 4).radius).toBe(4);
    expect(angleBetweenVectors3D({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 12);
    expect(arePerpendicular3D({ x: 1, y: 0, z: 0 }, { x: 0, y: 2, z: 0 })).toBe(true);
  });

  it("calculates point-to-line and point-to-plane distance in 3D", () => {
    const line = line3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(distancePointLine3D({ x: 0, y: 3, z: 4 }, line)).toBe(5);
    const plane = planeThroughPointNormal({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 1 });
    expect(distancePointPlane3D({ x: 1, y: 2, z: 5 }, plane)).toBeCloseTo(3, 12);
  });

  it("classifies circles and derives the circle equation", () => {
    const circle = circle2D({ x: 2, y: -1 }, 3);
    expect(pointCircleRelation({ x: 2, y: -1 }, circle)).toBe("inside");
    expect(pointCircleRelation({ x: 5, y: -1 }, circle)).toBe("on");
    expect(pointCircleRelation({ x: 6, y: -1 }, circle)).toBe("outside");
    expect(circleEquationCoefficients(circle)).toEqual({ D: -4, E: 2, F: -4 });
    expect(circleArea(1)).toBeCloseTo(Math.PI, 12);
    expect(circleCircumference(1)).toBeCloseTo(2 * Math.PI, 12);
  });

  it("uses Pythagoras and Heron to classify triangles", () => {
    expect(pythagoreanHypotenuse(3, 4)).toBe(5);
    const triangle = analyzeTriangle(3, 4, 5);
    expect(triangle.area).toBeCloseTo(6, 12);
    expect(triangle.angleType).toBe("right");
    expect(analyzeTriangle(2, 2, 2).kind).toBe("equilateral");
    expect(() => analyzeTriangle(1, 2, 4)).toThrow(/do not form/);
  });
});
