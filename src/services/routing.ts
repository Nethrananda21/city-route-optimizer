export interface Coordinate {
  lat: number;
  lng: number;
}

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
  algorithm: string;
}

/**
 * Fast OSRM routing — uses Dijkstra-based Contraction Hierarchies internally.
 * Sub-second response for any distance worldwide.
 */
export async function fetchRoute(start: Coordinate, end: Coordinate): Promise<RouteData | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true`;

  try {
    console.log('Fetching route from OSRM...');
    const t0 = performance.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error('OSRM request failed');
    const data = await response.json();
    console.log(`OSRM responded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);

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
      algorithm: 'Dijkstra (Contraction Hierarchies)'
    };
  } catch (error) {
    console.error('Error computing route:', error);
    return null;
  }
}
