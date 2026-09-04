import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const LocationTracker = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    let watchId: number;

    const startTracking = () => {
      if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
          async (position) => {
            const { latitude, longitude, accuracy } = position.coords;

            try {
              await supabase
                .from("user_locations")
                .upsert({
                  user_id: user.id,
                  latitude,
                  longitude,
                  accuracy,
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: "user_id"
                });
            } catch (error) {
              console.error("Error updating location:", error);
            }
          },
          (error) => {
            console.error("Geolocation error:", error);
            if (error.code === error.PERMISSION_DENIED) {
              toast.error("Location permission denied. Please enable location access.");
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 27000,
          }
        );
      } else {
        toast.error("Geolocation is not supported by your browser");
      }
    };

    startTracking();

    return () => {
      if (watchId) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [user]);

  return null;
};
