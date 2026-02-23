import { useState } from "react";
import MapArea from "./components/MapArea";
import Sidebar from "./components/Sidebar";
import type { RouteData } from "./services/routing";

function App() {
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex">
      {/* Background Map */}
      <div className="absolute inset-0 z-0">
        <MapArea routeData={routeData} />
      </div>

      {/* Foreground UI */}
      <div className="relative z-10 w-full h-full pointer-events-none flex">
        <Sidebar
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          onRouteCalculated={setRouteData}
        />

        {/* We can add other floating elements here like a top navbar or floating action buttons */}
      </div>
    </div>
  );
}

export default App;
