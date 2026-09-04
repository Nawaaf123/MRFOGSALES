import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { toast } from "sonner";

const UPDATE_INTERVAL_MS = 30_000;

export const LocationTracker = () => {
  const { user } = useAuth();
  const lastSent = useRef(0);

  useEffect(() => {
    if (!user || user.role === "admin") return;

    let watchId: number | undefined;

    const sendLocation = async (latitude: number, longitude: number, accuracy?: number) => {
      const now = Date.now();
      if (now - lastSent.current < UPDATE_INTERVAL_MS) return;
      lastSent.current = now;
      try {
        await api("/locations/me", {
          method: "PUT",
          body: JSON.stringify({
            latitude,
            longitude,
            accuracy: accuracy ?? null,
          }),
        });
      } catch (error) {
        console.error("Error updating location:", error);
      }
    };

    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        void sendLocation(latitude, longitude, accuracy);
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

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [user]);

  return null;
};
