import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { RouteData, Coordinate } from '../services/routing';
import L from 'leaflet';

// Fix Leaflet's default icon path issues
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom neon icon for markers
const neonIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background-color: #6366f1; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px 2px #8b5cf6;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

interface MapAreaProps {
  routeData: RouteData | null;
  userLocation: Coordinate | null;
}

// Component to dynamically fit bounds when route changes
const RouteBounds = ({ route }: { route: RouteData | null }) => {
  const map = useMap();

  useEffect(() => {
    if (route && route.geometry && route.geometry.length > 0) {
      const bounds = L.latLngBounds(route.geometry);
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1.5 });
    }
  }, [route, map]);

  return null;
};

// Fly to user location when it changes
const FlyToLocation = ({ location }: { location: Coordinate | null }) => {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.flyTo([location.lat, location.lng], 15, { duration: 1.5 });
    }
  }, [location, map]);
  return null;
};

const MapArea: React.FC<MapAreaProps> = ({ routeData, userLocation }) => {
  const [center] = useState<[number, number]>([20.5937, 78.9629]); // India

  return (
    <MapContainer 
      center={center} 
      zoom={5} 
      className="w-full h-full"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {/* User location marker */}
      {userLocation && (
        <>
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={20}
            pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1 }}
          />
          <CircleMarker
            center={[userLocation.lat, userLocation.lng]}
            radius={8}
            pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 3 }}
          >
            <Popup>📍 You are here</Popup>
          </CircleMarker>
          <FlyToLocation location={userLocation} />
        </>
      )}
      
      {routeData && routeData.geometry && (
        <>
          <Polyline 
            positions={routeData.geometry} 
            color="#8b5cf6" 
            weight={6} 
            opacity={0.8} 
            lineCap="round"
            lineJoin="round"
          />
          <Polyline 
            positions={routeData.geometry} 
            color="#6366f1" 
            weight={3} 
            opacity={1} 
            lineCap="round"
            lineJoin="round"
          />
          <Marker position={routeData.geometry[0]} icon={neonIcon}>
            <Popup className="glass-popup">Start</Popup>
          </Marker>
          <Marker position={routeData.geometry[routeData.geometry.length - 1]} icon={neonIcon}>
            <Popup className="glass-popup">Destination</Popup>
          </Marker>
          
          <RouteBounds route={routeData} />
        </>
      )}
    </MapContainer>
  );
};

export default MapArea;
