/**
 * Restore Shapes & Corners — Figma Plugin
 * Select a flattened path (rounded-rectangle turned into vectors).
 * The plugin reverse-engineers it into an editable rectangle with dynamic corner radius.
 */

const PLUGIN_VERSION = "1.0.4";
/** Injected at build time by scripts/inject-build.js */
const BUILD_TIMESTAMP = "";

type Point = { x: number; y: number };

interface PathSegment {
  type: "M" | "L" | "C" | "Q" | "Z";
  points: Point[]; // M,L: 1 point; C: 3 (cp1, cp2, end); Q: 2 (cp, end)
}

interface RoundedRectResult {
  x: number;
  y: number;
  width: number;
  height: number;
  topLeftRadius: number;
  topRightRadius: number;
  bottomRightRadius: number;
  bottomLeftRadius: number;
}

// Quarter-circle cubic Bezier: control point distance ≈ 0.552 * R (so R ≈ d/0.552)
const K = (4 / 3) * Math.tan(Math.PI / 8);
const INV_K = 1 / K;

function parsePathData(data: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const tokens = data.trim().split(/\s+/);
  let i = 0;
  let current: Point = { x: 0, y: 0 };

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (!cmd) {
      i++;
      continue;
    }
    const upper = cmd.toUpperCase();
    if (upper === "Z") {
      segments.push({ type: "Z", points: [] });
      i++;
      continue;
    }
    if (upper === "M" || upper === "L") {
      const x = parseFloat(tokens[++i]);
      const y = parseFloat(tokens[++i]);
      if (isNaN(x) || isNaN(y)) break;
      current = { x, y };
      segments.push({ type: upper as "M" | "L", points: [current] });
      i++;
      continue;
    }
    if (upper === "C") {
      const x0 = parseFloat(tokens[++i]);
      const y0 = parseFloat(tokens[++i]);
      const x1 = parseFloat(tokens[++i]);
      const y1 = parseFloat(tokens[++i]);
      const x = parseFloat(tokens[++i]);
      const y = parseFloat(tokens[++i]);
      if ([x0, y0, x1, y1, x, y].some((n) => isNaN(n))) break;
      current = { x, y };
      segments.push({
        type: "C",
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y1 },
          { x, y },
        ],
      });
      i++;
      continue;
    }
    if (upper === "Q") {
      const x0 = parseFloat(tokens[++i]);
      const y0 = parseFloat(tokens[++i]);
      const x = parseFloat(tokens[++i]);
      const y = parseFloat(tokens[++i]);
      if ([x0, y0, x, y].some((n) => isNaN(n))) break;
      current = { x, y };
      segments.push({
        type: "Q",
        points: [{ x: x0, y: y0 }, { x, y }],
      });
      i++;
      continue;
    }
    i++;
  }
  return segments;
}

function getPathBBox(segments: PathSegment[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const seg of segments) {
    for (const p of seg.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function estimateRadiusFromCubicWithStart(start: Point, cp1: Point, cp2: Point, end: Point): number {
  const d1 = Math.hypot(cp1.x - start.x, cp1.y - start.y);
  const d2 = Math.hypot(cp2.x - end.x, cp2.y - end.y);
  const d = (d1 + d2) / 2;
  return d * INV_K;
}

/** Classify which corner an arc belongs to (0=TL, 1=TR, 2=BR, 3=BL) using bbox. */
function cornerIndex(
  arcMid: Point,
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
): number {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const left = arcMid.x < cx;
  const top = arcMid.y < cy;
  if (top && left) return 0;
  if (top && !left) return 1;
  if (!top && left) return 3;
  return 2;
}

/**
 * Try to interpret path as a rounded rectangle: 4 lines + 4 curves (or 4 curves + 4 lines)
 * and return rect bounds + per-corner radii.
 */
function tryParseRoundedRect(pathData: string): RoundedRectResult | null {
  const segments = parsePathData(pathData);
  const curves = segments.filter((s) => s.type === "C" || s.type === "Q");
  if (curves.length !== 4) return null;

  const bbox = getPathBBox(segments);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  if (width <= 0 || height <= 0) return null;

  const radii = [0, 0, 0, 0]; // TL, TR, BR, BL
  const cornerCounts = [0, 0, 0, 0]; // how many curves land in each corner quadrant
  let prevEnd: Point | null = null;

  for (const seg of segments) {
    if (seg.type === "C" && seg.points.length >= 3) {
      const [cp1, cp2, end] = seg.points;
      const start = prevEnd ?? { x: seg.points[0].x, y: seg.points[0].y };
      const r = estimateRadiusFromCubicWithStart(start, cp1, cp2, end);
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const idx = cornerIndex(mid, bbox);
      cornerCounts[idx]++;
      radii[idx] = r;
      prevEnd = end;
    } else if (seg.type === "Q" && seg.points.length >= 2) {
      const [cp, end] = seg.points;
      const start = prevEnd ?? cp;
      const d =
        (Math.hypot(cp.x - start.x, cp.y - start.y) + Math.hypot(cp.x - end.x, cp.y - end.y)) / 2;
      const r = d * INV_K;
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const idx = cornerIndex(mid, bbox);
      cornerCounts[idx]++;
      radii[idx] = r;
      prevEnd = end;
    } else if (seg.type === "L" && seg.points.length > 0) {
      // Line segments in a real rounded rect are axis-aligned (horizontal or vertical).
      // If a line is diagonal, this is a freeform path — reject it.
      if (prevEnd !== null) {
        const end = seg.points[0];
        const dx = Math.abs(end.x - prevEnd.x);
        const dy = Math.abs(end.y - prevEnd.y);
        const len = Math.hypot(dx, dy);
        if (len > 0.5 && Math.min(dx, dy) / len > 0.1) return null;
      }
      prevEnd = seg.points[0];
    } else if (seg.type === "M" && seg.points.length > 0) {
      prevEnd = seg.points[0];
    }
  }

  // A rounded rect has exactly one curve per corner quadrant.
  // An S-curve or other freeform shape will have 2+ curves on the same side.
  if (!cornerCounts.every((c) => c === 1)) return null;

  const maxRadius = Math.min(width, height) / 2;
  const clamp = (r: number) => Math.max(0, Math.min(r, maxRadius));

  return {
    x: bbox.minX,
    y: bbox.minY,
    width,
    height,
    topLeftRadius: clamp(radii[0]),
    topRightRadius: clamp(radii[1]),
    bottomRightRadius: clamp(radii[2]),
    bottomLeftRadius: clamp(radii[3]),
  };
}

function getPathDataFromVector(node: VectorNode): string | null {
  try {
    const paths = node.vectorPaths;
    if (paths && paths.length > 0 && paths[0].data) return paths[0].data;
  } catch (_) {}
  return null;
}

interface EllipseResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StarParseResult {
  kind: "star";
  pointCount: number;
  innerRadius: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface PolygonParseResult {
  kind: "polygon";
  pointCount: number;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Get ordered boundary points from the first region loop. Walks by connectivity (loop segment order may not be walking order). */
function getOrderedBoundaryPoints(node: VectorNode): Point[] | null {
  const net = node.vectorNetwork;
  const { vertices, segments, regions } = net;
  if (!regions || regions.length === 0 || !regions[0].loops.length) return null;
  const loopSegIndices = regions[0].loops[0];
  if (loopSegIndices.length < 3) return null;
  const verts = vertices as Array<{ x: number; y: number }>;
  const segs = segments as Array<{ start: number; end: number }>;
  const segsInLoop = loopSegIndices.map((i) => segs[i]).filter(Boolean) as Array<{ start: number; end: number }>;
  if (segsInLoop.length < 3) return null;

  const vertexToSegs = new Map<number, Array<{ start: number; end: number }>>();
  for (const seg of segsInLoop) {
    for (const v of [seg.start, seg.end]) {
      if (!vertexToSegs.has(v)) vertexToSegs.set(v, []);
      vertexToSegs.get(v)!.push(seg);
    }
  }

  const ordered: number[] = [];
  const first = segsInLoop[0];
  ordered.push(first.start, first.end);
  let prev = first.end;
  const used = new Set<string>();
  used.add(first.start < first.end ? `${first.start}-${first.end}` : `${first.end}-${first.start}`);

  while (ordered.length < segsInLoop.length + 1) {
    const nextSegs = vertexToSegs.get(prev);
    if (!nextSegs) return fallbackOrderedFromLoop(verts, segsInLoop);
    let found: { start: number; end: number } | null = null;
    for (const seg of nextSegs) {
      const key = seg.start < seg.end ? `${seg.start}-${seg.end}` : `${seg.end}-${seg.start}`;
      if (used.has(key)) continue;
      found = seg;
      used.add(key);
      break;
    }
    if (!found) break;
    const nextV = found.start === prev ? found.end : found.start;
    ordered.push(nextV);
    if (nextV === ordered[0]) break;
    prev = nextV;
  }

  if (ordered.length < 3 || ordered[0] !== ordered[ordered.length - 1]) return fallbackOrderedFromLoop(verts, segsInLoop);
  ordered.pop();
  return ordered.map((i) => ({ x: verts[i].x, y: verts[i].y }));
}

function fallbackOrderedFromLoop(verts: Array<{ x: number; y: number }>, segsInLoop: Array<{ start: number; end: number }>): Point[] | null {
  const seen = new Set<number>();
  for (const seg of segsInLoop) {
    seen.add(seg.start);
    seen.add(seg.end);
  }
  const indices = Array.from(seen);
  if (indices.length < 3) return null;
  const points = indices.map((i) => ({ x: verts[i].x, y: verts[i].y }));
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const withAngle = points.map((p, idx) => ({
    angle: Math.atan2(p.y - cy, p.x - cx),
    point: p,
    idx: indices[idx],
  }));
  withAngle.sort((a, b) => a.angle - b.angle);
  return withAngle.map((w) => w.point);
}

function tryParseStarOrPolygonFromPoints(points: Point[]): Omit<StarParseResult, "minX" | "minY" | "width" | "height"> | Omit<PolygonParseResult, "minX" | "minY" | "width" | "height"> | null {
  const n = points.length;
  if (n < 3) return null;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  const withAngle = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { angle: Math.atan2(dy, dx), dist: Math.hypot(dx, dy), point: p };
  });
  withAngle.sort((a, b) => a.angle - b.angle);
  const dists = withAngle.map((d) => d.dist);
  const maxD = Math.max(...dists);
  if (maxD < 1e-6) return null;
  const tol = 0.2;
  const same = (a: number, b: number) => Math.abs(a - b) / (maxD || 1) <= tol;
  if (n % 2 === 0) {
    const half = n / 2;
    const groupA = dists.filter((_, i) => i % 2 === 0);
    const groupB = dists.filter((_, i) => i % 2 === 1);
    const meanA = groupA.reduce((a, b) => a + b, 0) / groupA.length;
    const meanB = groupB.reduce((a, b) => a + b, 0) / groupB.length;
    const outerMean = Math.max(meanA, meanB);
    const innerMean = Math.min(meanA, meanB);
    const outerSame = groupA.every((d) => same(d, groupA[0])) && groupB.every((d) => same(d, groupB[0]));
    const twoRings = outerMean > innerMean * 1.005 && outerSame;
    if (twoRings) {
      return {
        kind: "star",
        pointCount: half,
        innerRadius: Math.max(0, Math.min(1, innerMean / outerMean)),
      };
    }
  }
  const allSame = dists.every((d) => same(d, dists[0]));
  if (allSame) {
    return { kind: "polygon", pointCount: n };
  }
  return null;
}

/** Try to interpret path as a star or polygon: closed path with only line segments (M/L/Z). */
function tryParseStarOrPolygon(pathData: string): StarParseResult | PolygonParseResult | null {
  const segments = parsePathData(pathData);
  const points: Point[] = [];
  for (const seg of segments) {
    if (seg.type === "M" || seg.type === "L") points.push(seg.points[0]);
    else if (seg.type === "Z") break;
    else return null;
  }
  const hasZ = segments.some((s) => s.type === "Z");
  if (!hasZ || points.length < 3) return null;
  const parsed = tryParseStarOrPolygonFromPoints(points);
  if (!parsed) return null;
  const bbox = getPathBBox(segments);
  const b = { minX: bbox.minX, minY: bbox.minY, width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY };
  if (parsed.kind === "star") return { ...parsed, ...b };
  return { ...parsed, ...b };
}

/** Try to interpret vector network (any path, including curves) as a star or polygon. */
function tryParseStarOrPolygonFromNetwork(node: VectorNode): StarParseResult | PolygonParseResult | null {
  const points = getOrderedBoundaryPoints(node);
  if (!points || points.length < 3) return null;
  const parsed = tryParseStarOrPolygonFromPoints(points);
  if (!parsed) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;
  if (parsed.kind === "star") return { ...parsed, minX, minY, width, height };
  return { ...parsed, minX, minY, width, height };
}

/** Try to interpret path as ellipse/circle: closed path with 4 curves (flattened ellipse). */
function tryParseEllipse(pathData: string): EllipseResult | null {
  const segments = parsePathData(pathData);
  const curves = segments.filter((s) => s.type === "C" || s.type === "Q");
  if (curves.length !== 4) return null;
  const bbox = getPathBBox(segments);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  if (width <= 0 || height <= 0) return null;
  return {
    x: bbox.minX,
    y: bbox.minY,
    width,
    height,
  };
}

function runAsEllipse(node: VectorNode): boolean {
  const pathData = getPathDataFromVector(node);
  if (!pathData) return false;
  const parsed = tryParseEllipse(pathData);
  if (!parsed) return false;

  const parent = node.parent;
  if (!parent || !("appendChild" in parent)) return false;

  const ellipse = figma.createEllipse();
  ellipse.name = node.name + " (Restored corners)";
  ellipse.x = node.x + parsed.x;
  ellipse.y = node.y + parsed.y;
  ellipse.resize(parsed.width, parsed.height);
  ellipse.fills = Array.isArray(node.fills) ? node.fills : [];
  ellipse.strokes = Array.isArray(node.strokes) ? node.strokes : [];
  ellipse.strokeWeight = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
  ellipse.strokeAlign = typeof node.strokeAlign === "string" ? node.strokeAlign : "INSIDE";
  ellipse.rotation = node.rotation;
  if (node.opacity !== undefined) ellipse.opacity = node.opacity;
  if (node.effects && node.effects.length > 0) ellipse.effects = node.effects;

  const index = parent.children.indexOf(node);
  parent.insertChild(index, ellipse);
  node.remove();
  figma.currentPage.selection = [ellipse];
  figma.viewport.scrollAndZoomIntoView([ellipse]);
  return true;
}

/**
 * Build a vector network for a rounded rect: 4 vertices at the sharp corners, each with cornerRadius,
 * and 4 line segments. Figma rounds the corner at each vertex when it has exactly two segments.
 */
function buildNetworkFromRoundedRect(parsed: RoundedRectResult): {
  vertices: Array<{ x: number; y: number; cornerRadius: number }>;
  segments: Array<{ start: number; end: number }>;
  regions: Array<{ windingRule: "NONZERO"; loops: number[][] }>;
} {
  const { x: minX, y: minY, width, height } = parsed;
  const maxX = minX + width;
  const maxY = minY + height;
  const vertices = [
    { x: minX, y: minY, cornerRadius: parsed.topLeftRadius },
    { x: maxX, y: minY, cornerRadius: parsed.topRightRadius },
    { x: maxX, y: maxY, cornerRadius: parsed.bottomRightRadius },
    { x: minX, y: maxY, cornerRadius: parsed.bottomLeftRadius },
  ];
  const segments = [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 0 },
  ];
  return {
    vertices,
    segments,
    regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
  };
}

/** Default radius when we can't reverse-engineer (e.g. arbitrary path). User can adjust in panel. */
const DEFAULT_CORNER_RADIUS = 8;

type ToleranceSettings = {
  mergeDistancePx: number;
  radiusSameRatio: number;
};

const DEFAULT_TOLERANCE: ToleranceSettings = {
  mergeDistancePx: 14,
  radiusSameRatio: 0.05,
};

const STORAGE_KEY_TOLERANCE = "restoreRoundCorners_tolerance";

async function getTolerance(): Promise<ToleranceSettings> {
  try {
    const stored = await figma.clientStorage.getAsync(STORAGE_KEY_TOLERANCE);
    if (stored && typeof stored.mergeDistancePx === "number" && typeof stored.radiusSameRatio === "number") {
      return {
        mergeDistancePx: Math.max(1, Math.min(100, stored.mergeDistancePx)),
        radiusSameRatio: Math.max(0.01, Math.min(0.5, stored.radiusSameRatio)),
      };
    }
  } catch (_) {}
  return { ...DEFAULT_TOLERANCE };
}

async function setTolerance(s: ToleranceSettings): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY_TOLERANCE, {
    mergeDistancePx: Math.max(1, Math.min(100, s.mergeDistancePx)),
    radiusSameRatio: Math.max(0.01, Math.min(0.5, s.radiusSameRatio)),
  });
}

function dist(v: { x: number; y: number }, w: { x: number; y: number }): number {
  return Math.hypot(w.x - v.x, w.y - v.y);
}

/** Intersection of two lines: line through (p1,p2) and line through (p3,p4). Returns null if parallel. */
function lineLineIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** Dot product for 2D vectors. */
function dot(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * True when the segment's Bézier handles point toward each other (inner handles into the corner),
 * i.e. this segment is the arc of a rounded corner and its two endpoints should become one point.
 *
 * A rounded corner arc is a CONVEX curve: both control points (P1, P2) are on the same side
 * of the chord P0→P3. An S-curve has control points on opposite sides — we must reject those.
 */
function segmentHandlesPointTowardEachOther(
  seg: { start: number; end: number; tangentStart?: { x: number; y: number }; tangentEnd?: { x: number; y: number } },
  vertices: ReadonlyArray<{ x: number; y: number }>
): boolean {
  const ts = seg.tangentStart ?? { x: 0, y: 0 };
  const te = seg.tangentEnd ?? { x: 0, y: 0 };
  if (ts.x === 0 && ts.y === 0 && te.x === 0 && te.y === 0) return false;
  const a = vertices[seg.start];
  const b = vertices[seg.end];
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-6) return true;
  if (!(dot(ts, d) > 0 && dot(te, d) < 0)) return false;
  // Reject S-curves: cross(chord, ts) and cross(chord, te) must have the same sign,
  // meaning both control points are on the same side of the chord (convex arc).
  const cross1 = d.x * ts.y - d.y * ts.x;
  const cross2 = d.x * te.y - d.y * te.x;
  return cross1 * cross2 > 0;
}

/**
 * Estimate corner radius from the Bézier arc geometry: fit the arc to a circle using
 * chord length and sagitta (height of arc above the chord). For a circle, R = (c²/4 + h²) / (2h).
 * This restores the actual round corner size instead of assuming a quarter-circle.
 */
function estimateRadiusFromSegment(
  seg: { start: number; end: number; tangentStart?: { x: number; y: number }; tangentEnd?: { x: number; y: number } },
  vertices: ReadonlyArray<{ x: number; y: number }>
): number {
  const ts = seg.tangentStart ?? { x: 0, y: 0 };
  const te = seg.tangentEnd ?? { x: 0, y: 0 };
  const A = vertices[seg.start];
  const B = vertices[seg.end];
  const P0 = A;
  const P1 = { x: A.x + ts.x, y: A.y + ts.y };
  const P2 = { x: B.x + te.x, y: B.y + te.y };
  const P3 = B;

  const chord = dist(P0, P3);
  if (chord < 1e-6) return DEFAULT_CORNER_RADIUS;

  const mx = 0.125 * P0.x + 0.375 * P1.x + 0.375 * P2.x + 0.125 * P3.x;
  const my = 0.125 * P0.y + 0.375 * P1.y + 0.375 * P2.y + 0.125 * P3.y;
  const M = { x: mx, y: my };

  const ax = P3.x - P0.x;
  const ay = P3.y - P0.y;
  const mx0 = M.x - P0.x;
  const my0 = M.y - P0.y;
  const cross = Math.abs(mx0 * ay - my0 * ax);
  const sagitta = cross / chord;

  if (sagitta < 0.5) {
    const lenStart = Math.hypot(ts.x, ts.y);
    const lenEnd = Math.hypot(te.x, te.y);
    if (lenStart === 0 && lenEnd === 0) return DEFAULT_CORNER_RADIUS;
    return Math.max(1, (lenStart + lenEnd) / 2 * INV_K);
  }

  const R = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta);
  return Math.max(1, R);
}

interface CornerCandidate {
  segmentIndex: number;
  position: { x: number; y: number };
  estimatedRadius: number;
}

/** Detect merge candidates without modifying the shape. Used by the corner picker UI. */
function detectMergeCandidates(node: VectorNode, mergeDistancePx: number): CornerCandidate[] {
  const network = node.vectorNetwork;
  const { vertices, segments } = network;

  const hasStraightNeighbor = new Set<number>();
  for (const seg of segments) {
    const ts = seg.tangentStart ?? { x: 0, y: 0 };
    const te = seg.tangentEnd ?? { x: 0, y: 0 };
    if (Math.hypot(ts.x, ts.y) <= 0.5 && Math.hypot(te.x, te.y) <= 0.5) {
      hasStraightNeighbor.add(seg.start);
      hasStraightNeighbor.add(seg.end);
    }
  }

  const candidates: CornerCandidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const a = vertices[seg.start];
    const b = vertices[seg.end];
    const ts = seg.tangentStart ?? { x: 0, y: 0 };
    const te = seg.tangentEnd ?? { x: 0, y: 0 };
    const isCurved = Math.hypot(ts.x, ts.y) > 0.5 || Math.hypot(te.x, te.y) > 0.5;
    const byProximity = dist(a, b) <= mergeDistancePx && isCurved;
    const byHandles = segmentHandlesPointTowardEachOther(seg, vertices);
    if (!byProximity && !byHandles) continue;
    if (!hasStraightNeighbor.has(seg.start) && !hasStraightNeighbor.has(seg.end)) continue;

    let farA: number | null = null;
    let farB: number | null = null;
    for (let j = 0; j < segments.length; j++) {
      if (j === i) continue;
      const s = segments[j];
      if (farA === null) {
        if (s.start === seg.start && s.end !== seg.end) farA = s.end;
        else if (s.end === seg.start && s.start !== seg.end) farA = s.start;
      }
      if (farB === null) {
        if (s.start === seg.end && s.end !== seg.start) farB = s.end;
        else if (s.end === seg.end && s.start !== seg.start) farB = s.start;
      }
    }
    if (farA !== null && farB !== null) {
      const vFarA = vertices[farA];
      const vFarB = vertices[farB];
      const dAx = a.x - vFarA.x;
      const dAy = a.y - vFarA.y;
      const lenA = Math.hypot(dAx, dAy);
      const dBx = vFarB.x - b.x;
      const dBy = vFarB.y - b.y;
      const lenB = Math.hypot(dBx, dBy);
      if (lenA > 1e-6 && lenB > 1e-6) {
        const cosAngle = (dAx * dBx + dAy * dBy) / (lenA * lenB);
        if (cosAngle > 0.85) continue;
      }
    }

    const radius = estimateRadiusFromSegment(seg, vertices);
    candidates.push({
      segmentIndex: i,
      position: { x: Math.round((a.x + b.x) / 2 * 10) / 10, y: Math.round((a.y + b.y) / 2 * 10) / 10 },
      estimatedRadius: Math.round(radius * 10) / 10,
    });
  }
  return candidates;
}

/**
 * Find segments that represent a rounded corner arc and merge their endpoints into
 * one vertex with cornerRadius. If onlySegmentIndices is provided, only those
 * segments are merged (used by the corner picker UI).
 */
async function mergeCloseCornersAndRound(node: VectorNode, mergeDistancePx: number, onlySegmentIndices?: number[]): Promise<boolean> {
  const network = node.vectorNetwork;
  const { vertices, segments, regions } = network;
  const n = vertices.length;

  let mergeSegmentIndices: number[];
  if (onlySegmentIndices !== undefined) {
    mergeSegmentIndices = onlySegmentIndices.filter(i => i >= 0 && i < segments.length);
  } else {
    const candidates = detectMergeCandidates(node, mergeDistancePx);
    mergeSegmentIndices = candidates.map(c => c.segmentIndex);
  }

  if (mergeSegmentIndices.length === 0) {
    return false;
  }

  const mergeGroups: Array<{ pair: [number, number]; segIdx: number }> = [];
  const merged = new Set<number>();
  for (const segIdx of mergeSegmentIndices) {
    const seg = segments[segIdx];
    const s = seg.start;
    const e = seg.end;
    if (merged.has(s) || merged.has(e)) continue;
    mergeGroups.push({ pair: [s, e], segIdx });
    merged.add(s);
    merged.add(e);
  }

  const oldToNewVertex: number[] = [];
  let newIdx = 0;
  const newVertices: Array<{ x: number; y: number; cornerRadius?: number }> = [];
  for (let i = 0; i < n; i++) {
    const group = mergeGroups.find((g) => g.pair.includes(i));
    if (group) {
      if (group.pair[0] !== i) continue;
      const [i0, i1] = group.pair;
      const v0 = vertices[i0];
      const v1 = vertices[i1];
      const arcSegIdx = group.segIdx;
      let otherA: number | null = null;
      let otherB: number | null = null;
      for (let si = 0; si < segments.length; si++) {
        if (si === arcSegIdx) continue;
        const s = segments[si];
        if (s.start === i0 && s.end !== i1) otherA = s.end;
        else if (s.end === i0 && s.start !== i1) otherA = s.start;
        if (s.start === i1 && s.end !== i0) otherB = s.end;
        else if (s.end === i1 && s.start !== i0) otherB = s.start;
      }
      const midpoint: Point = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
      const chordLen = dist(v0, v1);
      let pos: Point = midpoint;
      if (otherA != null && otherB != null) {
        const sharp = lineLineIntersection(
          vertices[otherA],
          v0,
          v1,
          vertices[otherB]
        );
        if (sharp != null) {
          const maxDist = Math.max(chordLen * 2, 50);
          if (dist(sharp, midpoint) <= maxDist) pos = sharp;
        }
      }
      const seg = segments[arcSegIdx];
      const radius = estimateRadiusFromSegment(seg, vertices);
      newVertices.push({
        x: pos.x,
        y: pos.y,
        cornerRadius: radius,
      });
      oldToNewVertex[i0] = newIdx;
      oldToNewVertex[i1] = newIdx;
      newIdx++;
    } else {
      newVertices.push({ x: vertices[i].x, y: vertices[i].y });
      oldToNewVertex[i] = newIdx;
      newIdx++;
    }
  }

  const removedSegments = new Set(mergeSegmentIndices);
  const oldToNewSegment: number[] = [];
  let segNewIdx = 0;
  const newSegments: Array<{ start: number; end: number; tangentStart?: { x: number; y: number }; tangentEnd?: { x: number; y: number } }> = [];
  for (let i = 0; i < segments.length; i++) {
    if (removedSegments.has(i)) {
      oldToNewSegment[i] = -1;
      continue;
    }
    const seg = segments[i];
    const newStart = oldToNewVertex[seg.start];
    const newEnd = oldToNewVertex[seg.end];
    if (newStart === newEnd) {
      oldToNewSegment[i] = -1;
      continue;
    }
    const newSeg: { start: number; end: number; tangentStart?: { x: number; y: number }; tangentEnd?: { x: number; y: number } } = {
      start: newStart,
      end: newEnd,
    };
    if (seg.tangentStart) newSeg.tangentStart = { x: seg.tangentStart.x, y: seg.tangentStart.y };
    if (seg.tangentEnd) newSeg.tangentEnd = { x: seg.tangentEnd.x, y: seg.tangentEnd.y };
    newSegments.push(newSeg);
    oldToNewSegment[i] = segNewIdx++;
  }

  const newRegions: Array<{ windingRule: "NONZERO" | "EVENODD"; loops: number[][] }> = [];
  if (regions) {
    for (const reg of regions) {
      const newLoops: number[][] = [];
      for (const loop of reg.loops) {
        const newLoop: number[] = [];
        for (const si of loop) {
          const mapped = oldToNewSegment[si];
          if (mapped >= 0) newLoop.push(mapped);
        }
        if (newLoop.length >= 2) newLoops.push(newLoop);
      }
      if (newLoops.length > 0) {
        newRegions.push({ windingRule: reg.windingRule, loops: newLoops });
      }
    }
  }

  await node.setVectorNetworkAsync({
    vertices: newVertices,
    segments: newSegments,
    regions: newRegions.length > 0 ? newRegions : [],
  });
  return true;
}

/**
 * On any vector, set cornerRadius on every vertex that has exactly 2 segments (a corner).
 * Figma only applies corner radius to such vertices. Makes sharp corners roundable.
 */
async function roundCornersInNetwork(node: VectorNode): Promise<void> {
  const network = node.vectorNetwork;
  const { vertices, segments, regions } = network;
  const segmentCountByVertex: Record<number, number> = {};
  for (const seg of segments) {
    segmentCountByVertex[seg.start] = (segmentCountByVertex[seg.start] ?? 0) + 1;
    segmentCountByVertex[seg.end] = (segmentCountByVertex[seg.end] ?? 0) + 1;
  }
  const newVertices = vertices.map((v, i) => {
    const count = segmentCountByVertex[i] ?? 0;
    const out: { x: number; y: number; cornerRadius?: number } = { x: v.x, y: v.y };
    if (count === 2) out.cornerRadius = DEFAULT_CORNER_RADIUS;
    return out;
  });
  await node.setVectorNetworkAsync({
    vertices: newVertices,
    segments,
    regions: regions ?? [],
  });
}

/** Replace vector with a Rectangle node so the design panel shows radius handles. Use for flattened rounded boxes. */
function runAsRectangle(node: VectorNode, radiusSameRatio: number = 0.05): boolean {
  const pathData = getPathDataFromVector(node);
  if (!pathData) return false;
  const parsed = tryParseRoundedRect(pathData);
  if (!parsed) return false;

  const parent = node.parent;
  if (!parent || !("appendChild" in parent)) return false;

  const rect = figma.createRectangle();
  rect.name = node.name + " (Restored corners)";
  rect.x = node.x + parsed.x;
  rect.y = node.y + parsed.y;
  rect.resize(parsed.width, parsed.height);
  const radii = [
    parsed.topLeftRadius,
    parsed.topRightRadius,
    parsed.bottomRightRadius,
    parsed.bottomLeftRadius,
  ];
  const minR = Math.min(...radii);
  const maxR = Math.max(...radii);
  const meanR = radii.reduce((a, b) => a + b, 0) / 4;
  const spread = maxR - minR;
  const somewhatSame = spread <= 1 || (meanR > 0.001 && spread / meanR <= radiusSameRatio);
  if (somewhatSame) {
    const sorted = [...radii].sort((a, b) => a - b);
    const median = (sorted[1] + sorted[2]) / 2;
    rect.cornerRadius = median;
  } else {
    rect.topLeftRadius = parsed.topLeftRadius;
    rect.topRightRadius = parsed.topRightRadius;
    rect.bottomRightRadius = parsed.bottomRightRadius;
    rect.bottomLeftRadius = parsed.bottomLeftRadius;
  }
  rect.fills = Array.isArray(node.fills) ? node.fills : [];
  rect.strokes = Array.isArray(node.strokes) ? node.strokes : [];
  rect.strokeWeight = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
  rect.strokeAlign = typeof node.strokeAlign === "string" ? node.strokeAlign : "INSIDE";
  rect.rotation = node.rotation;
  if (node.opacity !== undefined) rect.opacity = node.opacity;
  if (node.effects && node.effects.length > 0) rect.effects = node.effects;

  const index = parent.children.indexOf(node);
  parent.insertChild(index, rect);
  node.remove();
  figma.currentPage.selection = [rect];
  figma.viewport.scrollAndZoomIntoView([rect]);
  return true;
}

function runAsStarOrPolygonWithParsed(node: VectorNode, parsed: StarParseResult | PolygonParseResult): boolean {
  const parent = node.parent;
  if (!parent || !("appendChild" in parent)) return false;

  const { minX, minY, width, height } = parsed;
  if (width <= 0 || height <= 0) return false;

  let shape: StarNode | PolygonNode;
  if (parsed.kind === "star") {
    const star = figma.createStar();
    star.pointCount = parsed.pointCount;
    star.innerRadius = parsed.innerRadius;
    shape = star;
  } else {
    const polygon = figma.createPolygon();
    polygon.pointCount = parsed.pointCount;
    shape = polygon;
  }

  shape.name = node.name + " (Restored corners)";
  shape.x = node.x + minX;
  shape.y = node.y + minY;
  shape.resize(width, height);
  shape.fills = Array.isArray(node.fills) ? node.fills : [];
  shape.strokes = Array.isArray(node.strokes) ? node.strokes : [];
  shape.strokeWeight = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
  shape.strokeAlign = typeof node.strokeAlign === "string" ? node.strokeAlign : "INSIDE";
  shape.rotation = node.rotation;
  if (node.opacity !== undefined) shape.opacity = node.opacity;
  if (node.effects && node.effects.length > 0) shape.effects = node.effects;

  const index = parent.children.indexOf(node);
  parent.insertChild(index, shape);
  node.remove();
  figma.currentPage.selection = [shape];
  figma.viewport.scrollAndZoomIntoView([shape]);
  return true;
}

function runAsStarOrPolygon(node: VectorNode): boolean {
  const parsed = tryParseStarOrPolygonFromNetwork(node) ?? tryParseStarOrPolygon(getPathDataFromVector(node) ?? "");
  return parsed ? runAsStarOrPolygonWithParsed(node, parsed) : false;
}

type ApplyResult = { success: boolean; message: string; canUndo: boolean };

type UndoState =
  | { kind: "asRectangle"; cloneId: string; rectId: string }
  | { kind: "asEllipse"; cloneId: string; ellipseId: string }
  | { kind: "asStar"; cloneId: string; starId: string }
  | { kind: "inPlace"; nodeId: string; network: VectorNetwork };

let lastUndoState: UndoState | UndoState[] | null = null;

const CORNER_COLORS = ["#EB4034", "#0D99FF", "#14B860", "#FFAA00", "#A349E6", "#FF5FA2"];

function getSelectedVectors(): VectorNode[] {
  const selection = figma.currentPage.selection;
  return selection.filter((n): n is VectorNode => n.type === "VECTOR");
}

function hasValidSelection(): boolean {
  return getSelectedVectors().length > 0;
}

/** Preview text for current selection and command (does not modify anything). */
async function getPreview(command: "asRectangle" | "inPlace" | "shapes", nodes: VectorNode[]): Promise<string> {
  if (nodes.length === 0) return "Select one or more vectors (e.g. flattened rounded rectangles).";
  const n = nodes.length;
  const plural = n > 1 ? ` (${n} shapes)` : "";

  if (command === "asRectangle") {
    const pathData = getPathDataFromVector(nodes[0]);
    const parsed = pathData ? tryParseRoundedRect(pathData) : null;
    if (parsed) {
      const r = (parsed.topLeftRadius + parsed.topRightRadius + parsed.bottomRightRadius + parsed.bottomLeftRadius) / 4;
      return `Replace with rectangle${plural}, radius ~${Math.round(r)}px.`;
    }
    return `Not a rounded rectangle. Try Freeshape or Shapes.`;
  }

  if (command === "inPlace") {
    const tol = await getTolerance();
    return `Merge/round corners${plural} (merge distance ${tol.mergeDistancePx}px).`;
  }

  if (command === "shapes") {
    const node = nodes[0];
    const pathData = getPathDataFromVector(node);
    if (pathData && tryParseEllipse(pathData))
      return `Will replace with ellipse${plural}.`;
    if (pathData && tryParseRoundedRect(pathData))
      return `Will replace with rectangle${plural}.`;
    const starParsed = tryParseStarOrPolygonFromNetwork(node) ?? (pathData ? tryParseStarOrPolygon(pathData) : null);
    if (starParsed) {
      if (starParsed.kind === "star") return `Will replace with star${plural}.`;
      return `Will replace with polygon${plural}.`;
    }
    return `Will merge/round corners in place${plural} (or no change if sharp).`;
  }

  return "";
}

function cloneVectorNetwork(net: VectorNetwork): VectorNetwork {
  return JSON.parse(JSON.stringify(net));
}

async function executeCommand(command: "asRectangle" | "inPlace" | "shapes"): Promise<void> {
  const result = await executeCommandWithResult(command);
  if (result) figma.notify(result.message);
}

async function executeSingle(
  node: VectorNode,
  command: "asRectangle" | "inPlace" | "shapes",
  tolerance: ToleranceSettings,
  selectedCorners?: number[]
): Promise<{ undo: UndoState | null; message: string }> {
  if (command === "shapes") {
    const pathData = getPathDataFromVector(node);
    if (pathData && tryParseEllipse(pathData)) {
      const clone = node.clone();
      clone.remove();
      const ok = runAsEllipse(node);
      if (ok) {
        const ellipse = figma.currentPage.selection[0];
        if (ellipse) return { undo: { kind: "asEllipse", cloneId: clone.id, ellipseId: ellipse.id }, message: "Replaced with ellipse." };
      }
      clone.remove();
    }
    if (pathData && tryParseRoundedRect(pathData)) {
      const clone = node.clone();
      clone.remove();
      const ok = runAsRectangle(node, tolerance.radiusSameRatio);
      if (ok) {
        const rect = figma.currentPage.selection[0];
        if (rect) return { undo: { kind: "asRectangle", cloneId: clone.id, rectId: rect.id }, message: "Replaced with rectangle." };
      }
      clone.remove();
    }
    const starParsed = tryParseStarOrPolygonFromNetwork(node) ?? (pathData ? tryParseStarOrPolygon(pathData) : null);
    if (starParsed) {
      const clone = node.clone();
      clone.remove();
      const ok = runAsStarOrPolygonWithParsed(node, starParsed);
      if (ok) {
        const star = figma.currentPage.selection[0];
        if (star) return { undo: { kind: "asStar", cloneId: clone.id, starId: star.id }, message: "Replaced with star/polygon." };
      }
      clone.remove();
    }
    command = "inPlace";
  }

  if (command === "asRectangle") {
    const clone = node.clone();
    clone.remove();
    const ok = runAsRectangle(node, tolerance.radiusSameRatio);
    if (!ok) {
      clone.remove();
      return { undo: null, message: "Not a rounded rectangle. Try Freeshape or Shapes." };
    }
    const rect = figma.currentPage.selection[0];
    if (rect) return { undo: { kind: "asRectangle", cloneId: clone.id, rectId: rect.id }, message: "Replaced with rectangle." };
    clone.remove();
    return { undo: null, message: "Replaced with rectangle." };
  }

  if (command === "inPlace") {
    const savedNetwork = cloneVectorNetwork(node.vectorNetwork);
    const nodeId = node.id;
    const pathData = getPathDataFromVector(node);
    try {
      // When specific corners are selected via the picker, skip auto-detection
      // and merge only those segments.
      if (selectedCorners !== undefined) {
        const merged = await mergeCloseCornersAndRound(node, tolerance.mergeDistancePx, selectedCorners);
        if (merged) return { undo: { kind: "inPlace", nodeId, network: savedNetwork }, message: "Rounded selected corners." };
        return { undo: null, message: "No corners merged. Shape unchanged." };
      }
      if (pathData) {
        const parsed = tryParseRoundedRect(pathData);
        if (parsed) {
          const network = buildNetworkFromRoundedRect(parsed);
          await node.setVectorNetworkAsync(network);
          return { undo: { kind: "inPlace", nodeId, network: savedNetwork }, message: "Corners restored on vector." };
        }
      }
      const merged = await mergeCloseCornersAndRound(node, tolerance.mergeDistancePx);
      if (merged) return { undo: { kind: "inPlace", nodeId, network: savedNetwork }, message: "Merged close points into rounded corner." };
      return { undo: null, message: "No rounded corners detected. Shape unchanged." };
    } catch (e) {
      return { undo: null, message: "Could not update this vector. Try simplifying the path." };
    }
  }

  return { undo: null, message: "" };
}

async function executeCommandWithResult(command: "asRectangle" | "inPlace" | "shapes", selectedCorners?: number[]): Promise<ApplyResult | null> {
  const vectors = getSelectedVectors();
  if (vectors.length === 0) {
    return { success: false, message: "Select one or more vectors (e.g. flattened rounded rectangles).", canUndo: false };
  }

  lastUndoState = null;
  const tolerance = await getTolerance();
  const undos: UndoState[] = [];
  const messages: string[] = [];
  const selectedIds = new Set(vectors.map((v) => v.id));

  for (const node of vectors) {
    const result = await executeSingle(node, command, tolerance, selectedCorners);
    if (result.undo) undos.push(result.undo);
    if (result.message) messages.push(result.message);
    const newSelection = figma.currentPage.selection;
    const lastNew = newSelection.length > 0 ? newSelection[newSelection.length - 1] : null;
    if (lastNew && !selectedIds.has(lastNew.id)) figma.currentPage.selection = [...vectors.filter((v) => v.parent), lastNew];
  }

  if (undos.length === 0 && messages.length > 0 && messages.some((m) => m.includes("Could not") || m.includes("Not a"))) {
    return { success: false, message: messages[0], canUndo: false };
  }
  if (undos.length > 0) lastUndoState = undos.length === 1 ? undos[0] : undos;
  const summary = undos.length === 0 ? (messages[0] || "Nothing changed.") : undos.length === 1 ? messages[0] : `Processed ${undos.length} shapes.`;
  return { success: true, message: summary, canUndo: undos.length > 0 };
}

async function performSingleUndo(state: UndoState): Promise<boolean> {
  if (state.kind === "asRectangle") {
    const rect = (await figma.getNodeByIdAsync(state.rectId)) as SceneNode | null;
    const clone = (await figma.getNodeByIdAsync(state.cloneId)) as SceneNode | null;
    if (rect && clone && rect.parent && "insertChild" in rect.parent) {
      const parent = rect.parent;
      const index = parent.children.indexOf(rect);
      rect.remove();
      parent.insertChild(index, clone);
      figma.currentPage.selection = [clone];
      figma.viewport.scrollAndZoomIntoView([clone]);
      return true;
    }
    return false;
  }
  if (state.kind === "asEllipse") {
    const ellipse = (await figma.getNodeByIdAsync(state.ellipseId)) as SceneNode | null;
    const clone = (await figma.getNodeByIdAsync(state.cloneId)) as SceneNode | null;
    if (ellipse && clone && ellipse.parent && "insertChild" in ellipse.parent) {
      const parent = ellipse.parent;
      const index = parent.children.indexOf(ellipse);
      ellipse.remove();
      parent.insertChild(index, clone);
      figma.currentPage.selection = [clone];
      figma.viewport.scrollAndZoomIntoView([clone]);
      return true;
    }
    return false;
  }
  if (state.kind === "asStar") {
    const star = (await figma.getNodeByIdAsync(state.starId)) as SceneNode | null;
    const clone = (await figma.getNodeByIdAsync(state.cloneId)) as SceneNode | null;
    if (star && clone && star.parent && "insertChild" in star.parent) {
      const parent = star.parent;
      const index = parent.children.indexOf(star);
      star.remove();
      parent.insertChild(index, clone);
      figma.currentPage.selection = [clone];
      figma.viewport.scrollAndZoomIntoView([clone]);
      return true;
    }
    return false;
  }
  if (state.kind === "inPlace") {
    const node = await figma.getNodeByIdAsync(state.nodeId);
    if (node && node.type === "VECTOR") {
      await node.setVectorNetworkAsync(state.network);
      figma.currentPage.selection = [node];
      return true;
    }
    return false;
  }
  return false;
}

async function performUndo(): Promise<boolean> {
  if (!lastUndoState) return false;
  const states = Array.isArray(lastUndoState) ? [...lastUndoState] : [lastUndoState];
  lastUndoState = null;
  let ok = false;
  for (let i = states.length - 1; i >= 0; i--) {
    const result = await performSingleUndo(states[i]);
    if (result) ok = true;
  }
  return ok;
}

function run(): void {
  const command = figma.command || "showUI";

  if (command === "showUI") {
    figma.showUI(__html__, { width: 462, height: 560, title: "Restore Shapes & Corners" });
    const sendSelectionState = async () => {
      const vectors = getSelectedVectors();
      const tolerance = await getTolerance();
      figma.ui.postMessage({
        type: "selectionChange",
        hasSelection: vectors.length > 0,
        selectionCount: vectors.length,
        tolerance: { mergeDistancePx: tolerance.mergeDistancePx, radiusSameRatio: tolerance.radiusSameRatio },
      });
    };
    figma.ui.onmessage = async (msg: { type?: string; command?: string; tolerance?: ToleranceSettings; selectedCorners?: number[]; width?: number; height?: number }) => {
      if (msg.type === "ready") {
        const tolerance = await getTolerance();
        const vectors = getSelectedVectors();
        const preview = await getPreview("asRectangle", vectors);
        figma.ui.postMessage({
          type: "init",
          version: PLUGIN_VERSION,
          buildTimestamp: BUILD_TIMESTAMP && BUILD_TIMESTAMP !== "dev" ? BUILD_TIMESTAMP : "",
          hasSelection: vectors.length > 0,
          selectionCount: vectors.length,
          preview,
          tolerance: { mergeDistancePx: tolerance.mergeDistancePx, radiusSameRatio: tolerance.radiusSameRatio },
        });
        figma.on("selectionchange", () => sendSelectionState());
        return;
      }
      if (msg.type === "requestPreview" && (msg.command === "asRectangle" || msg.command === "inPlace" || msg.command === "shapes")) {
        const vectors = getSelectedVectors();
        const preview = await getPreview(msg.command, vectors);
        figma.ui.postMessage({ type: "preview", preview });
        return;
      }
      if (msg.type === "getTolerance") {
        const t = await getTolerance();
        figma.ui.postMessage({ type: "tolerance", tolerance: { mergeDistancePx: t.mergeDistancePx, radiusSameRatio: t.radiusSameRatio } });
        return;
      }
      if (msg.type === "setTolerance" && msg.tolerance) {
        await setTolerance(msg.tolerance);
        sendSelectionState();
        return;
      }
      if (msg.type === "resize" && msg.width && msg.height) {
        figma.ui.resize(msg.width, msg.height);
        return;
      }
      if (msg.type === "detectCorners") {
        const vectors = getSelectedVectors();
        if (vectors.length === 0) {
          figma.ui.postMessage({ type: "corners", corners: [], error: "No vector selected." });
          return;
        }
        try {
          const tolerance = await getTolerance();
          const allCandidates: CornerCandidate[] = [];
          const colors: string[] = [];
          const paths: string[] = [];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const v of vectors) {
            const candidates = detectMergeCandidates(v, tolerance.mergeDistancePx);
            allCandidates.push(...candidates);
            const pathData = getPathDataFromVector(v);
            if (pathData) paths.push(pathData);
            const w = v.width;
            const h = v.height;
            if (0 < minX) minX = 0;
            if (0 < minY) minY = 0;
            if (w > maxX) maxX = w;
            if (h > maxY) maxY = h;
          }
          for (let i = 0; i < allCandidates.length; i++) {
            colors.push(CORNER_COLORS[i % CORNER_COLORS.length]);
          }
          figma.ui.postMessage({
            type: "corners",
            corners: allCandidates,
            colors,
            paths,
            bbox: { minX, minY, maxX, maxY },
          });
        } catch (e) {
          figma.ui.postMessage({ type: "corners", corners: [], error: "Detection failed: " + String(e) });
        }
        return;
      }
      if (msg.type === "apply" && (msg.command === "asRectangle" || msg.command === "inPlace" || msg.command === "shapes")) {
        executeCommandWithResult(msg.command, msg.selectedCorners).then((result) => {
          if (result) figma.ui.postMessage({ type: "result", ...result });
        });
        return;
      }
      if (msg.type === "undo") {
        performUndo().then((ok) => {
          figma.ui.postMessage({ type: "undoResult", success: ok });
        });
        return;
      }
      if (msg.type === "close") {
        figma.ui.close();
        figma.closePlugin();
      }
    };
    return;
  }

  if (command === "asRectangle" || command === "inPlace" || command === "shapes") {
    executeCommand(command).then(() => figma.closePlugin());
    return;
  }

  figma.closePlugin();
}

run();
