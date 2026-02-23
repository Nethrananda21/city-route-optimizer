import type { Coordinate } from './routing';

interface OsmWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}

// Distance between two coordinates in meters (Haversine formula)
export function haversineDistance(c1: Coordinate, c2: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (val: number) => val * Math.PI / 180;
  
  const dLat = toRad(c2.lat - c1.lat);
  const dLon = toRad(c2.lng - c1.lng);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(c1.lat)) * Math.cos(toRad(c2.lat)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
            
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class MinPriorityQueue {
  private elements: { id: number, priority: number }[] = [];

  enqueue(id: number, priority: number) {
    this.elements.push({ id, priority });
    this.elements.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this.elements.shift();
  }

  isEmpty() {
    return this.elements.length === 0;
  }
}

export async function computeDijkstraRoute(start: Coordinate, end: Coordinate): Promise<[number, number][] | null> {
  // 1. Define bounding box slightly larger than the two points
  const pad = 0.02; // approx 2km padding
  const minLat = Math.min(start.lat, end.lat) - pad;
  const maxLat = Math.max(start.lat, end.lat) + pad;
  const minLon = Math.min(start.lng, end.lng) - pad;
  const maxLon = Math.max(start.lng, end.lng) + pad;
  
  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
  
  // 2. Fetch road network from Overpass API
  // We filter by highway tags that are drivable
  const query = `
    [out:json];
    (
      way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential"](${bbox});
    );
    out body;
    >;
    out skel qt;
  `;
  
  const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  
  console.log("Fetching Overpass Data...");
  const res = await fetch(overpassUrl);
  if (!res.ok) throw new Error("Overpass API failed");
  const data = await res.json();
  
  // 3. Parse nodes and ways
  const nodes = new Map<number, Coordinate>();
  const ways: OsmWay[] = [];
  
  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { lat: el.lat, lng: el.lon });
    } else if (el.type === 'way') {
      ways.push({ id: el.id, nodes: el.nodes, tags: el.tags || {} });
    }
  }
  
  // 4. Build Graph (Adjacency List)
  const graph = new Map<number, { to: number, weight: number }[]>();
  
  const addEdge = (from: number, to: number, weight: number) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from)!.push({ to, weight });
  };
  
  for (const way of ways) {
    const isOneWay = way.tags['oneway'] === 'yes';
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const n1 = way.nodes[i];
      const n2 = way.nodes[i + 1];
      const c1 = nodes.get(n1);
      const c2 = nodes.get(n2);
      
      if (c1 && c2) {
        const dist = haversineDistance(c1, c2);
        addEdge(n1, n2, dist);
        if (!isOneWay) {
          addEdge(n2, n1, dist);
        }
      }
    }
  }
  
  // 5. Find nearest nodes to start and end coordinates
  let startNodeId = -1;
  let endNodeId = -1;
  let minStartDist = Infinity;
  let minEndDist = Infinity;
  
  for (const [id, coord] of nodes.entries()) {
    // Only consider nodes that are part of the graph (connected to a way)
    if (!graph.has(id)) continue;
    
    const dStart = haversineDistance(start, coord);
    if (dStart < minStartDist) {
      minStartDist = dStart;
      startNodeId = id;
    }
    
    const dEnd = haversineDistance(end, coord);
    if (dEnd < minEndDist) {
      minEndDist = dEnd;
      endNodeId = id;
    }
  }
  
  if (startNodeId === -1 || endNodeId === -1) {
    console.error("Could not find nearby road nodes");
    return null;
  }
  
  // 6. Run Custom Dijkstra
  console.log("Running Custom Dijkstra on Graph...");
  const distances = new Map<number, number>();
  const previous = new Map<number, number>();
  const pq = new MinPriorityQueue();
  
  for (const id of graph.keys()) {
    distances.set(id, Infinity);
  }
  distances.set(startNodeId, 0);
  pq.enqueue(startNodeId, 0);
  
  while (!pq.isEmpty()) {
    const current = pq.dequeue();
    if (!current) break;
    
    const { id: currId, priority: currDist } = current;
    
    if (currId === endNodeId) break; // Found shortest path
    if (currDist > distances.get(currId)!) continue;
    
    const neighbors = graph.get(currId) || [];
    for (const neighbor of neighbors) {
      const alt = currDist + neighbor.weight;
      if (alt < distances.get(neighbor.to)!) {
        distances.set(neighbor.to, alt);
        previous.set(neighbor.to, currId);
        pq.enqueue(neighbor.to, alt);
      }
    }
  }
  
  // 7. Reconstruct path
  const path: number[] = [];
  let curr: number | undefined = endNodeId;
  while (curr !== undefined) {
    path.unshift(curr);
    curr = previous.get(curr);
    if (curr === startNodeId) {
      path.unshift(curr);
      break;
    }
  }
  
  if (path.length === 0 || path[0] !== startNodeId) {
    console.error("No path found");
    return null;
  }
  
  // Map back to lat/lng geometry
  const geometry: [number, number][] = path.map(id => [nodes.get(id)!.lat, nodes.get(id)!.lng]);
  return geometry;
}
