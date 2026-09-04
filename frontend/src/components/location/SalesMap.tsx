import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const POLL_MS = 30_000;

type SalesLocation = {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
  full_name: string | null;
  email: string | null;
};

export const SalesMap = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  const fetchAndDisplayLocations = useCallback(async () => {
    if (!map.current) return;
    try {
      const locations = await api<SalesLocation[]>("/locations");

      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();

      locations.forEach((location) => {
        const el = document.createElement("div");
        el.className = "sales-marker";
        el.style.width = "32px";
        el.style.height = "32px";
        el.style.backgroundImage =
          "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNEOTVENEUiLz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTIiIGZpbGw9IndoaXRlIi8+CjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjgiIGZpbGw9IiNEOTVENEUiLz4KPC9zdmc+Cg==')";
        el.style.backgroundSize = "100%";
        el.style.cursor = "pointer";

        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div style="padding: 8px;">
            <h3 style="font-weight: 600; margin-bottom: 4px;">${location.full_name || "Unknown"}</h3>
            <p style="font-size: 12px; color: #666; margin-bottom: 4px;">${location.email || ""}</p>
            <p style="font-size: 11px; color: #999;">Last updated: ${new Date(location.updated_at).toLocaleString()}</p>
          </div>
        `);

        const marker = new mapboxgl.Marker(el)
          .setLngLat([location.longitude, location.latitude])
          .setPopup(popup)
          .addTo(map.current!);

        markers.current.set(location.user_id, marker);
      });

      if (locations.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        locations.forEach((location) => {
          bounds.extend([location.longitude, location.latitude]);
        });
        map.current.fitBounds(bounds, { padding: 50, maxZoom: 12 });
      }
    } catch (error) {
      console.error("Error fetching locations:", error);
    }
  }, []);

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setMapError("Mapbox token missing. Set VITE_MAPBOX_TOKEN in your environment.");
      setLoading(false);
      return;
    }

    if (!mapContainer.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-98.5795, 39.8283],
        zoom: 4,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.current.on("load", () => {
        setLoading(false);
        void fetchAndDisplayLocations();
      });

      map.current.on("error", () => {
        setMapError("Failed to load map");
        setLoading(false);
      });

      const interval = window.setInterval(() => {
        void fetchAndDisplayLocations();
      }, POLL_MS);

      return () => {
        window.clearInterval(interval);
        map.current?.remove();
        map.current = null;
      };
    } catch (error) {
      console.error("Error initializing map:", error);
      setMapError("Failed to initialize map");
      setLoading(false);
    }
  }, [fetchAndDisplayLocations]);

  return (
    <Card className="relative w-full h-[500px] overflow-hidden">
      {loading && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10 p-6 text-center">
          <p className="text-destructive">{mapError}</p>
        </div>
      )}
      {!mapError && (
        <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "500px" }} />
      )}
    </Card>
  );
};
