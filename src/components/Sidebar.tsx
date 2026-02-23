import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, Search, Menu, X, ArrowRight, Clock, Map as MapIcon, Crosshair } from 'lucide-react';
import { fetchRoute } from '../services/routing';
import type { RouteData, Coordinate } from '../services/routing';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onRouteCalculated: (data: RouteData | null) => void;
}

// Helper to format duration
const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Helper to format distance
const formatDistance = (meters: number) => {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
};

// Fast geocoding — race Photon AND Nominatim, first response wins
const geocode = async (query: string): Promise<Coordinate | null> => {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('geocode timeout')), 3000)
    );

    const photon = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (!data?.features?.length) throw new Error('empty');
        const [lng, lat] = data.features[0].geometry.coordinates;
        return { lat, lng } as Coordinate;
      });

    const nominatim = fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (!data?.length) throw new Error('empty');
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } as Coordinate;
      });

    return await Promise.any([photon, nominatim, timeout]) as Coordinate;
  } catch (e) {
    console.error('Geocode failed:', e);
    return null;
  }
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  icon: React.ReactNode;
  iconBgHover: string;
}

// Global cache shared across all instances
const suggestionsCache = new Map<string, any[]>();

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({ value, onChange, placeholder, icon, iconBgHover }) => {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const justSelected = useRef(false);
  const debouncedValue = useDebounce(value, 80);

  useEffect(() => {
    // After a selection, the value changes but we don't want to re-fetch/re-open
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    if (!debouncedValue || debouncedValue.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    const key = debouncedValue.toLowerCase().trim();

    if (suggestionsCache.has(key)) {
      setSuggestions(suggestionsCache.get(key)!);
      setIsOpen(true);
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    const fetchSuggestions = async () => {
      try {
        // Race Photon AND Nominatim — whoever responds first wins
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000)
        );

        const photonFetch = fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(debouncedValue)}&limit=5`,
          { signal }
        ).then(r => r.json()).then(data => {
          if (!data?.features?.length) throw new Error('empty');
          return data.features.map((f: any) => ({
            name: f.properties.name || '',
            street: f.properties.street || '',
            city: f.properties.city || '',
            state: f.properties.state || '',
            country: f.properties.country || '',
          }));
        });

        const nominatimFetch = fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(debouncedValue)}&format=json&limit=5&addressdetails=1`,
          { signal }
        ).then(r => r.json()).then(data => {
          if (!data?.length) throw new Error('empty');
          return data.map((item: any) => ({
            name: item.display_name?.split(',')[0] || '',
            street: item.address?.road || '',
            city: item.address?.city || item.address?.town || item.address?.village || '',
            state: item.address?.state || '',
            country: item.address?.country || '',
          }));
        });

        const results = await Promise.any([photonFetch, nominatimFetch, timeout]) as any[];
        suggestionsCache.set(key, results);
        setSuggestions(results);
        setIsOpen(true);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error(e);
      }
    };
    fetchSuggestions();

    return () => controller.abort();
  }, [debouncedValue]);

  const handleSelect = (s: any) => {
    const name = s.name || '';
    const city = s.city || s.state || '';
    const fullName = city ? `${name}, ${city}` : name;
    justSelected.current = true;
    setSuggestions([]);
    setIsOpen(false);
    onChange(fullName || 'Unknown location');
  };

  return (
    <div className={`relative flex items-center gap-3 group ${isOpen ? 'z-50' : 'z-10'}`}>
      <div className={`w-8 h-8 rounded-full bg-black/40 border border-white/10 flex items-center justify-center flex-shrink-0 transition-colors ${iconBgHover}`}>
        {icon}
      </div>
      <div className="relative w-full">
        <input 
          type="text" 
          value={value}
          onChange={(e) => {
             justSelected.current = false;
             onChange(e.target.value);
          }}
          onFocus={() => suggestions.length > 0 && !justSelected.current && setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          placeholder={placeholder} 
          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50 focus:bg-black/40 transition-all text-white placeholder-gray-500"
        />
        <AnimatePresence>
          {isOpen && suggestions.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.12 }}
              className="absolute top-full left-0 right-0 mt-1 bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden shadow-2xl shadow-black/50 z-[100] text-sm"
            >
              {suggestions.map((s, i) => (
                <div 
                  key={i} 
                  className="px-4 py-2.5 hover:bg-indigo-500/20 cursor-pointer text-gray-300 hover:text-white transition-colors border-b border-white/5 last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur from firing
                    handleSelect(s);
                  }}
                >
                  <div className="font-medium text-white text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {[s.street, s.city, s.state, s.country].filter(Boolean).join(', ')}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen, onRouteCalculated }) => {
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{distance: number, duration: number, algorithm: string} | null>(null);
  const [startCoordOverride, setStartCoordOverride] = useState<Coordinate | null>(null);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setStartCoordOverride(coord);
        setStartQuery(`📍 My Location (${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)})`);
      },
      () => alert('Unable to get your location. Please allow location access.'),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startQuery || !endQuery) return;

    setIsLoading(true);
    setRouteInfo(null);
    onRouteCalculated(null);

    // Run both geocodes in PARALLEL, use coordinate override if GPS was used
    const [startCoord, endCoord] = await Promise.all([
      startCoordOverride ? Promise.resolve(startCoordOverride) : geocode(startQuery),
      geocode(endQuery)
    ]);

    if (startCoord && endCoord) {
      const route = await fetchRoute(startCoord, endCoord);
      if (route) {
        onRouteCalculated(route);
        setRouteInfo({ distance: route.distance, duration: route.duration, algorithm: route.algorithm });
      } else {
        alert('Could not find a route between these locations.');
      }
    } else {
      alert('Could not locate one of the addresses.');
    }

    setIsLoading(false);
  };

  return (
    <>
      {/* Mobile Toggle Button */}
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="absolute top-6 left-6 z-50 p-3 rounded-full glass-panel pointer-events-auto hover:bg-white/10 transition-colors"
        >
          <Menu className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Sidebar Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute top-0 left-0 h-full w-[380px] z-40 p-6 pointer-events-auto flex flex-col"
          >
            <div className="glass-panel w-full h-full rounded-2xl flex flex-col overflow-hidden relative">
              
              {/* Header */}
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                    <Navigation className="w-6 h-6" />
                  </div>
                  <h1 className="text-xl font-semibold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                    CityRoute
                  </h1>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-full hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Area */}
              <div className="p-6 flex-shrink-0">
                <form onSubmit={handleSearch} className="space-y-4 relative">
                  {/* Decorative line */}
                  <div className="absolute left-[1.1rem] top-8 bottom-12 w-0.5 bg-gradient-to-b from-indigo-500/50 to-purple-500/50 z-0"></div>

                  <AddressAutocomplete
                    value={startQuery}
                    onChange={(v) => { setStartQuery(v); setStartCoordOverride(null); }}
                    placeholder="Start point"
                    icon={<div className="w-2.5 h-2.5 rounded-full bg-indigo-500"></div>}
                    iconBgHover="group-hover:border-indigo-500/50"
                  />

                  {/* Use My Location Button */}
                  <div className="relative z-10 pl-11">
                    <button
                      type="button"
                      onClick={handleUseMyLocation}
                      className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors py-1"
                    >
                      <Crosshair className="w-3 h-3" />
                      Use my current location
                    </button>
                  </div>

                  <AddressAutocomplete
                    value={endQuery}
                    onChange={setEndQuery}
                    placeholder="Destination"
                    icon={<MapPin className="w-4 h-4 text-purple-400" />}
                    iconBgHover="group-hover:border-purple-500/50"
                  />

                  <button 
                    type="submit" 
                    disabled={isLoading}
                    className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl py-3.5 px-4 font-medium flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Find route</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Results Area */}
              {routeInfo && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar"
                >
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10 mb-6 flex items-center justify-around">
                    <div className="flex flex-col items-center">
                      <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> Distance
                      </div>
                      <div className="text-xl font-semibold text-white">
                        {formatDistance(routeInfo.distance)}
                      </div>
                    </div>
                    <div className="w-px h-10 bg-white/10"></div>
                    <div className="flex flex-col items-center">
                      <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Est. Time
                      </div>
                      <div className="text-xl font-semibold text-white">
                        {formatDuration(routeInfo.duration)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      ⚡ {routeInfo.algorithm}
                    </span>
                  </div>

                  <div className="text-center text-sm text-gray-400 flex items-center justify-center gap-2 mt-4">
                    <MapIcon className="w-4 h-4 opacity-50" />
                    Interactive map generated with Leaflet
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
