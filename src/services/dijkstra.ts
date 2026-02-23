import type { Coordinate } from './routing';

// ============================================================
// HAVERSINE DISTANCE (meters)
// ============================================================
const DEG_TO_RAD = Math.PI / 180;

export function haversineDistance(c1: Coordinate, c2: Coordinate): number {
  const R = 6371e3;
  const dLat = (c2.lat - c1.lat) * DEG_TO_RAD;
  const dLon = (c2.lng - c1.lng) * DEG_TO_RAD;
  const a =
    Math.sin(dLat * 0.5) * Math.sin(dLat * 0.5) +
    Math.cos(c1.lat * DEG_TO_RAD) * Math.cos(c2.lat * DEG_TO_RAD) *
    Math.sin(dLon * 0.5) * Math.sin(dLon * 0.5);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fast approximation for heuristic (no trig, ~0.5% error at city scale)
function fastApproxDistance(c1: Coordinate, c2: Coordinate): number {
  const latMid = (c1.lat + c2.lat) * 0.5 * DEG_TO_RAD;
  const dx = (c2.lng - c1.lng) * DEG_TO_RAD * Math.cos(latMid) * 6371e3;
  const dy = (c2.lat - c1.lat) * DEG_TO_RAD * 6371e3;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================
// BINARY MIN-HEAP (O(log n) insert/extract)
// ============================================================
class BinaryMinHeap {
  private heap: { id: number; f: number }[] = [];

  get size() { return this.heap.length; }

  push(id: number, f: number) {
    this.heap.push({ id, f });
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): { id: number; f: number } | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].f >= this.heap[parent].f) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private _sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].f < this.heap[smallest].f) smallest = l;
      if (r < n && this.heap[r].f < this.heap[smallest].f) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

// ============================================================
// OVERPASS NETWORK CACHE
// ============================================================
interface GraphData {
  nodes: Map<number, Coordinate>;
  graph: Map<number, { to: number; weight: number }[]>;
}

const networkCache = new Map<string, GraphData>();

function bboxKey(minLat: number, minLon: number, maxLat: number, maxLon: number) {
  return `${minLat.toFixed(4)},${minLon.toFixed(4)},${maxLat.toFixed(4)},${maxLon.toFixed(4)}`;
}

async function fetchRoadNetwork(start: Coordinate, end: Coordinate): Promise<GraphData> {
  const pad = 0.015; // ~1.5km padding — tight bbox = fast query
  const minLat = Math.min(start.lat, end.lat) - pad;
  const maxLat = Math.max(start.lat, end.lat) + pad;
  const minLon = Math.min(start.lng, end.lng) - pad;
  const maxLon = Math.max(start.lng, end.lng) + pad;

  const key = bboxKey(minLat, minLon, maxLat, maxLon);
  if (networkCache.has(key)) {
    console.log('Road network cache HIT');
    return networkCache.get(key)!;
  }

  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;

  // Leaner query: only major drivable roads, compact output
  const query = `[out:json][timeout:10];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"](${bbox});out body qt;>;out skel qt;`;

  console.log('Fetching road network from Overpass...');
  const t0 = performance.now();
  const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Overpass API failed');
  const data = await res.json();
  console.log(`Overpass responded in ${((performance.now() - t0) / 1000).toFixed(1)}s — ${data.elements.length} elements`);

  const nodes = new Map<number, Coordinate>();
  const graph = new Map<number, { to: number; weight: number }[]>();

  // Parse all elements in a single pass
  const ways: { nodes: number[]; oneway: boolean }[] = [];
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    } else if (el.type === 'way') {
      ways.push({ nodes: el.nodes, oneway: el.tags?.oneway === 'yes' });
    }
  }

  // Build adjacency list
  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i], b = way.nodes[i + 1];
      const ca = nodes.get(a), cb = nodes.get(b);
      if (!ca || !cb) continue;
      const d = haversineDistance(ca, cb);
      if (!graph.has(a)) graph.set(a, []);
      graph.get(a)!.push({ to: b, weight: d });
      if (!way.oneway) {
        if (!graph.has(b)) graph.set(b, []);
        graph.get(b)!.push({ to: a, weight: d });
      }
    }
  }

  const result = { nodes, graph };
  networkCache.set(key, result);
  return result;
}

// ============================================================
// A* SEARCH (Dijkstra + heuristic = much faster)
// ============================================================
export async function computeDijkstraRoute(start: Coordinate, end: Coordinate): Promise<[number, number][] | null> {
  const { nodes, graph } = await fetchRoadNetwork(start, end);

  // Find nearest graph nodes to start/end
  let startNode = -1, endNode = -1;
  let minSD = Infinity, minED = Infinity;

  for (const [id, coord] of nodes) {
    if (!graph.has(id)) continue;
    const ds = fastApproxDistance(start, coord);
    const de = fastApproxDistance(end, coord);
    if (ds < minSD) { minSD = ds; startNode = id; }
    if (de < minED) { minED = de; endNode = id; }
  }

  if (startNode === -1 || endNode === -1) {
    console.error('No nearby road nodes');
    return null;
  }

  const endCoord = nodes.get(endNode)!;

  // A* with binary heap
  console.log(`Running A* (Dijkstra + heuristic) on ${graph.size} nodes...`);
  const t0 = performance.now();

  const gScore = new Map<number, number>();
  const prev = new Map<number, number>();
  const pq = new BinaryMinHeap();
  let visited = 0;

  gScore.set(startNode, 0);
  pq.push(startNode, fastApproxDistance(nodes.get(startNode)!, endCoord));

  while (pq.size > 0) {
    const curr = pq.pop()!;
    visited++;

    if (curr.id === endNode) {
      console.log(`Path found! Visited ${visited} nodes in ${((performance.now() - t0)).toFixed(0)}ms`);
      break;
    }

    const currG = gScore.get(curr.id) ?? Infinity;
    const neighbors = graph.get(curr.id);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      const tentG = currG + edge.weight;
      if (tentG < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentG);
        prev.set(edge.to, curr.id);
        const h = fastApproxDistance(nodes.get(edge.to)!, endCoord);
        pq.push(edge.to, tentG + h);
      }
    }
  }

  // Reconstruct path
  if (!prev.has(endNode) && startNode !== endNode) {
    console.error('No path found');
    return null;
  }

  const path: number[] = [];
  let c: number | undefined = endNode;
  while (c !== undefined && c !== startNode) {
    path.unshift(c);
    c = prev.get(c);
  }
  path.unshift(startNode);

  return path.map(id => {
    const n = nodes.get(id)!;
    return [n.lat, n.lng] as [number, number];
  });
}
