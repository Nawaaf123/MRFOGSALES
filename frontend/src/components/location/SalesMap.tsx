import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const MAPBOX_TOKEN = "pk.eyJ1IjoibmF3YWFmbW9oZDIyIiwiYSI6ImNtaXFjN3JvcjBhNjczanEwM2d1YzRrdzYifQ.ze4RFBLUOIh50vU10LsByg";

interface SalesLocation {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  updated_at: string;
}

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
}

export const SalesMap = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current) {
      console.error("Map container not found");
      return;
    }

    // Set access token before creating map
    mapboxgl.accessToken = MAPBOX_TOKEN;

    try {
      // Initialize map
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-98.5795, 39.8283], // Center of USA
        zoom: 4,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.current.on("load", () => {
        console.log("Mapbox map loaded successfully");
        setLoading(false);
        fetchAndDisplayLocations();
      });

      map.current.on("error", (e) => {
        console.error("Mapbox error:", e);
        setMapError("Failed to load map");
        setLoading(false);
      });

      // Subscribe to realtime updates
      const channel = supabase
        .channel("user_locations_changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_locations",
          },
          () => {
            fetchAndDisplayLocations();
          }
        )
        .subscribe();

      return () => {
        map.current?.remove();
        supabase.removeChannel(channel);
      };
    } catch (error) {
      console.error("Error initializing map:", error);
      setMapError("Failed to initialize map");
      setLoading(false);
    }
  }, []);

  const fetchAndDisplayLocations = async () => {
    const { data: locations, error: locError } = await supabase
      .from("user_locations")
      .select("*");

    if (locError) {
      console.error("Error fetching locations:", locError);
      return;
    }

    if (!locations || !map.current) return;

    // Fetch profiles separately
    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("id, full_name, email");

    if (profError) {
      console.error("Error fetching profiles:", profError);
      return;
    }

    const profileMap = new Map<string, UserProfile>();
    profiles?.forEach((profile) => {
      profileMap.set(profile.id, profile);
    });

    // Clear existing markers
    markers.current.forEach((marker) => marker.remove());
    markers.current.clear();

    // Add markers for each location
    locations.forEach((location) => {
      const el = document.createElement("div");
      el.className = "sales-marker";
      el.style.width = "32px";
      el.style.height = "32px";
      el.style.backgroundImage = "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNEOTVENEUiLz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTIiIGZpbGw9IndoaXRlIi8+CjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjgiIGZpbGw9IiNEOTVENEUiLz4KPC9zdmc+Cg==')";
      el.style.backgroundSize = "100%";
      el.style.cursor = "pointer";

      const profile = profileMap.get(location.user_id);

      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="padding: 8px;">
          <h3 style="font-weight: 600; margin-bottom: 4px;">${profile?.full_name || "Unknown"}</h3>
          <p style="font-size: 12px; color: #666; margin-bottom: 4px;">${profile?.email || ""}</p>
          <p style="font-size: 11px; color: #999;">Last updated: ${new Date(location.updated_at).toLocaleString()}</p>
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([location.longitude, location.latitude])
        .setPopup(popup)
        .addTo(map.current!);

      markers.current.set(location.user_id, marker);
    });

    // Fit bounds to show all markers
    if (locations.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      locations.forEach((location) => {
        bounds.extend([location.longitude, location.latitude]);
      });
      map.current.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    }
  };

  return (
    <Card className="relative w-full h-[500px] overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
          <p className="text-destructive">{mapError}</p>
        </div>
      )}
      <div 
        ref={mapContainer} 
        className="w-full h-full"
        style={{ minHeight: "500px" }}
      />
    </Card>
  );
};
