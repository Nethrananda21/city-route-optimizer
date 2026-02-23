export interface Coordinate {
  lat: number;
  lng: number;
}

import { computeDijkstraRoute, haversineDistance } from './dijkstra';

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
}

export interface RouteData {
  geometry: [number, number][]; // Array of [lat, lng]
  distance: number; // in meters
  duration: number; // in seconds
  steps: RouteStep[];
  algorithm: 'dijkstra' | 'osrm'; // Which algorithm was used
}

// Max straight-line distance (in meters) for local Dijkstra routing
// Beyond this, the Overpass bounding box is too large and will timeout
const DIJKSTRA_MAX_DISTANCE = 15_000; // 15 km

/**
 * OSRM fallback for long-distance routes.
 * OSRM uses Contraction Hierarchies (a Dijkstra-based optimization) internally.
 */
async function fetchOSRMRoute(start: Coordinate, end: Coordinate): Promise<RouteData | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true`;

  const response = await fetch(url);
  if (!response.ok) throw new Error('OSRM request failed');
  const data = await response.json();

  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;

  const route = data.routes[0];
  const geometry: [number, number][] = route.geometry.coordinates.map(
    (coord: [number, number]) => [coord[1], coord[0]]
  );

  const steps = route.legs[0].steps.map((step: any) => ({
    instruction: step.maneuver.modifier
      ? `${step.maneuver.type} ${step.maneuver.modifier} on ${step.name || 'unnamed road'}`
      : `${step.maneuver.type} on ${step.name || 'unnamed road'}`,
    distance: step.distance,
    duration: step.duration
  }));

  return {
    geometry,
    distance: route.distance,
    duration: route.duration,
    steps,
    algorithm: 'osrm'
  };
}

/**
 * Local Dijkstra routing for short-distance (city-level) routes.
 */
async function fetchDijkstraRoute(start: Coordinate, end: Coordinate): Promise<RouteData | null> {
  const geometry = await computeDijkstraRoute(start, end);
  if (!geometry) return null;

  let distance = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    distance += haversineDistance(
      { lat: geometry[i][0], lng: geometry[i][1] },
      { lat: geometry[i + 1][0], lng: geometry[i + 1][1] }
    );
  }

  const duration = (distance / 40000) * 3600; // ~40 km/h urban speed

  return {
    geometry,
    distance,
    duration,
    steps: [{ instruction: 'Follow the highlighted shortest path.', distance, duration }],
    algorithm: 'dijkstra'
  };
}

/**
 * Hybrid router: uses custom Dijkstra for short distances,
 * falls back to OSRM (Dijkstra-based Contraction Hierarchies) for long distances.
 */
export async function fetchRoute(start: Coordinate, end: Coordinate): Promise<RouteData | null> {
  const straightLine = haversineDistance(start, end);
  console.log(`Straight-line distance: ${(straightLine / 1000).toFixed(1)} km`);

  try {
    if (straightLine <= DIJKSTRA_MAX_DISTANCE) {
      console.log('Using local Dijkstra algorithm...');
      const result = await fetchDijkstraRoute(start, end);
      if (result) return result;
      // If Dijkstra fails, fall through to OSRM
      console.log('Dijkstra failed, falling back to OSRM...');
    } else {
      console.log('Distance too large for local Dijkstra, using OSRM (Dijkstra-based CH)...');
    }

    return await fetchOSRMRoute(start, end);
  } catch (error) {
    console.error('Error computing route:', error);
    return null;
  }
}
