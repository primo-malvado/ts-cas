/** Numerical helpers for plane and solid geometry. */

export interface Point2D { readonly x: number; readonly y: number; }
export interface Point3D { readonly x: number; readonly y: number; readonly z: number; }
export interface Vector2D { readonly x: number; readonly y: number; }
export interface Vector3D { readonly x: number; readonly y: number; readonly z: number; }
export interface Line2D { /** Line equation a*x + b*y + c = 0. */ readonly a: number; readonly b: number; readonly c: number; }
export interface Circle2D { readonly center: Point2D; readonly radius: number; }
export interface Sphere3D { readonly center: Point3D; readonly radius: number; }
export interface Plane3D { /** Plane equation a*x + b*y + c*z + d = 0, with a unit normal. */ readonly a: number; readonly b: number; readonly c: number; readonly d: number; }
export interface Line3D { readonly point: Point3D; readonly direction: Vector3D; }
export type LineIntersection2D =
  | { readonly kind: "point"; readonly point: Point2D }
  | { readonly kind: "parallel" }
  | { readonly kind: "coincident" };

const EPSILON = 1e-12;
function assertFinite(...values: number[]): void {
  if (values.some(value => !Number.isFinite(value))) throw new RangeError("Coordinates and measurements must be finite numbers.");
}
function assertPoint2(p: Point2D): void { assertFinite(p.x, p.y); }
function assertPoint3(p: Point3D): void { assertFinite(p.x, p.y, p.z); }

export function distance2D(a: Point2D, b: Point2D): number {
  assertPoint2(a); assertPoint2(b);
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function midpoint2D(a: Point2D, b: Point2D): Point2D {
  assertPoint2(a); assertPoint2(b);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
export function vectorFromPoints2D(a: Point2D, b: Point2D): Vector2D {
  assertPoint2(a); assertPoint2(b);
  return { x: b.x - a.x, y: b.y - a.y };
}
export function dot2D(a: Vector2D, b: Vector2D): number {
  assertFinite(a.x, a.y, b.x, b.y);
  return a.x * b.x + a.y * b.y;
}
export function norm2D(v: Vector2D): number { assertFinite(v.x, v.y); return Math.hypot(v.x, v.y); }
export function slope2D(a: Point2D, b: Point2D): number | null {
  assertPoint2(a); assertPoint2(b);
  const dx = b.x - a.x;
  if (Math.abs(dx) <= EPSILON) return null;
  return (b.y - a.y) / dx;
}
export function lineThroughPoints2D(a: Point2D, b: Point2D): Line2D {
  assertPoint2(a); assertPoint2(b);
  if (distance2D(a, b) <= EPSILON) throw new RangeError("Two distinct points are required to define a line.");
  const A = a.y - b.y;
  const B = b.x - a.x;
  const C = a.x * b.y - b.x * a.y;
  const norm = Math.hypot(A, B);
  return { a: A / norm, b: B / norm, c: C / norm };
}
export function distancePointLine2D(point: Point2D, line: Line2D): number {
  assertPoint2(point); assertFinite(line.a, line.b, line.c);
  const norm = Math.hypot(line.a, line.b);
  if (norm <= EPSILON) throw new RangeError("A line must have at least one non-zero direction coefficient.");
  return Math.abs(line.a * point.x + line.b * point.y + line.c) / norm;
}
export function intersectLines2D(first: Line2D, second: Line2D): LineIntersection2D {
  assertFinite(first.a, first.b, first.c, second.a, second.b, second.c);
  const determinant = first.a * second.b - second.a * first.b;
  if (Math.abs(determinant) > EPSILON) {
    return {
      kind: "point",
      point: {
        x: (first.b * second.c - second.b * first.c) / determinant,
        y: (first.c * second.a - second.c * first.a) / determinant,
      },
    };
  }
  const parallel = Math.abs(first.a * second.c - second.a * first.c) <= EPSILON
    && Math.abs(first.b * second.c - second.b * first.c) <= EPSILON;
  return parallel ? { kind: "coincident" } : { kind: "parallel" };
}
export function circle2D(center: Point2D, radius: number): Circle2D {
  assertPoint2(center); assertFinite(radius);
  if (radius < 0) throw new RangeError("Circle radius cannot be negative.");
  return { center: { ...center }, radius };
}
export function pointCircleRelation(point: Point2D, circle: Circle2D): "inside" | "on" | "outside" {
  const d = distance2D(point, circle.center);
  const delta = d - circle.radius;
  if (Math.abs(delta) <= EPSILON * Math.max(1, d, circle.radius)) return "on";
  return delta < 0 ? "inside" : "outside";
}
export function circleEquationCoefficients(circle: Circle2D): { readonly D: number; readonly E: number; readonly F: number } {
  assertPoint2(circle.center); assertFinite(circle.radius);
  if (circle.radius < 0) throw new RangeError("Circle radius cannot be negative.");
  return {
    D: -2 * circle.center.x,
    E: -2 * circle.center.y,
    F: circle.center.x ** 2 + circle.center.y ** 2 - circle.radius ** 2,
  };
}
export function distance3D(a: Point3D, b: Point3D): number {
  assertPoint3(a); assertPoint3(b);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function midpoint3D(a: Point3D, b: Point3D): Point3D {
  assertPoint3(a); assertPoint3(b);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}
export function vectorFromPoints3D(a: Point3D, b: Point3D): Vector3D {
  assertPoint3(a); assertPoint3(b);
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
}
export function dot3D(a: Vector3D, b: Vector3D): number {
  assertFinite(a.x, a.y, a.z, b.x, b.y, b.z);
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function norm3D(v: Vector3D): number { assertFinite(v.x, v.y, v.z); return Math.hypot(v.x, v.y, v.z); }
export function cross3D(a: Vector3D, b: Vector3D): Vector3D {
  assertFinite(a.x, a.y, a.z, b.x, b.y, b.z);
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function angleBetweenVectors2D(a: Vector2D, b: Vector2D): number {
  const na = norm2D(a), nb = norm2D(b);
  if (na <= EPSILON || nb <= EPSILON) throw new RangeError("Angle is undefined for a zero vector.");
  const cosine = dot2D(a, b) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}
export function angleBetweenVectors3D(a: Vector3D, b: Vector3D): number {
  const na = norm3D(a), nb = norm3D(b);
  if (na <= EPSILON || nb <= EPSILON) throw new RangeError("Angle is undefined for a zero vector.");
  const cosine = dot3D(a, b) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}
export function arePerpendicular2D(a: Vector2D, b: Vector2D): boolean {
  const scale = norm2D(a) * norm2D(b);
  return scale > EPSILON && Math.abs(dot2D(a, b)) <= EPSILON * scale;
}
export function arePerpendicular3D(a: Vector3D, b: Vector3D): boolean {
  const scale = norm3D(a) * norm3D(b);
  return scale > EPSILON && Math.abs(dot3D(a, b)) <= EPSILON * scale;
}
export function line3D(point: Point3D, direction: Vector3D): Line3D {
  assertPoint3(point); assertFinite(direction.x, direction.y, direction.z);
  if (norm3D(direction) <= EPSILON) throw new RangeError("A line direction vector must be non-zero.");
  return { point: { ...point }, direction: { ...direction } };
}
export function distancePointLine3D(point: Point3D, line: Line3D): number {
  assertPoint3(point); assertPoint3(line.point); assertFinite(line.direction.x, line.direction.y, line.direction.z);
  const difference = vectorFromPoints3D(line.point, point);
  return norm3D(cross3D(difference, line.direction)) / norm3D(line.direction);
}
export function planeThroughPointNormal(point: Point3D, normal: Vector3D): Plane3D {
  assertPoint3(point); assertFinite(normal.x, normal.y, normal.z);
  const magnitude = norm3D(normal);
  if (magnitude <= EPSILON) throw new RangeError("A plane normal vector must be non-zero.");
  const a = normal.x / magnitude, b = normal.y / magnitude, c = normal.z / magnitude;
  return { a, b, c, d: -(a * point.x + b * point.y + c * point.z) };
}
export function distancePointPlane3D(point: Point3D, plane: Plane3D): number {
  assertPoint3(point); assertFinite(plane.a, plane.b, plane.c, plane.d);
  const magnitude = Math.hypot(plane.a, plane.b, plane.c);
  if (magnitude <= EPSILON) throw new RangeError("A plane must have a non-zero normal vector.");
  return Math.abs(plane.a * point.x + plane.b * point.y + plane.c * point.z + plane.d) / magnitude;
}

export function sphere3D(center: Point3D, radius: number): Sphere3D {
  assertPoint3(center); assertFinite(radius);
  if (radius < 0) throw new RangeError("Sphere radius cannot be negative.");
  return { center: { ...center }, radius };
}

export type TriangleKind = "equilateral" | "isosceles" | "scalene";
export type TriangleAngleType = "acute" | "right" | "obtuse";
export interface TriangleAnalysis {
  readonly valid: true;
  readonly sides: readonly [number, number, number];
  readonly perimeter: number;
  readonly semiperimeter: number;
  readonly area: number;
  readonly kind: TriangleKind;
  readonly angleType: TriangleAngleType;
  readonly anglesRadians: readonly [number, number, number];
}

/** Side-based triangle analysis via the triangle inequality, Heron's formula and cosine rule. */
export function analyzeTriangle(sideA: number, sideB: number, sideC: number): TriangleAnalysis {
  assertFinite(sideA, sideB, sideC);
  if (sideA <= 0 || sideB <= 0 || sideC <= 0) throw new RangeError("Triangle sides must be positive.");
  const sides = [sideA, sideB, sideC].sort((a, b) => a - b) as [number, number, number];
  const [a, b, c] = sides;
  if (a + b <= c + EPSILON * Math.max(1, c)) throw new RangeError("These lengths do not form a non-degenerate triangle.");
  const perimeter = a + b + c;
  const semiperimeter = perimeter / 2;
  // Heron's product is arranged to reduce cancellation for nearly degenerate triangles.
  const area = Math.sqrt(Math.max(0, semiperimeter * (semiperimeter - a) * (semiperimeter - b) * (semiperimeter - c)));
  const equalAB = Math.abs(a - b) <= EPSILON * Math.max(1, a, b);
  const equalBC = Math.abs(b - c) <= EPSILON * Math.max(1, b, c);
  const kind: TriangleKind = equalAB && equalBC ? "equilateral" : equalAB || equalBC ? "isosceles" : "scalene";
  const comparison = a * a + b * b - c * c;
  const angleType: TriangleAngleType = Math.abs(comparison) <= EPSILON * Math.max(1, c * c)
    ? "right" : comparison > 0 ? "acute" : "obtuse";
  const angleA = Math.acos(Math.max(-1, Math.min(1, (b * b + c * c - a * a) / (2 * b * c))));
  const angleB = Math.acos(Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c))));
  const angleC = Math.PI - angleA - angleB;
  return { valid: true, sides, perimeter, semiperimeter, area, kind, angleType, anglesRadians: [angleA, angleB, angleC] };
}

export function pythagoreanHypotenuse(legA: number, legB: number): number {
  assertFinite(legA, legB);
  if (legA < 0 || legB < 0) throw new RangeError("Triangle legs must be non-negative.");
  return Math.hypot(legA, legB);
}
export function circleArea(radius: number): number {
  assertFinite(radius);
  if (radius < 0) throw new RangeError("Circle radius cannot be negative.");
  return Math.PI * radius * radius;
}
export function circleCircumference(radius: number): number {
  assertFinite(radius);
  if (radius < 0) throw new RangeError("Circle radius cannot be negative.");
  return 2 * Math.PI * radius;
}
