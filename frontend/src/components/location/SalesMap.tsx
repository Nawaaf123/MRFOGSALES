import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const POLL_MS = 30_000;
const SHOPS_SOURCE = "shops-src";
const GLOW_LAYER = "shops-glow";
const DOTS_LAYER = "shops-dots";
const PINS_LAYER = "shops-pins";
const PIN_IMAGE = "shop-pin-red-glow";

type ShopPin = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
};

type FC = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatShopAddress(props: Record<string, unknown>) {
  const line1 = String(props.street_address || "");
  const line2 = [props.city, props.state, props.zip_code].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join("<br/>") || "No address";
}

function toCoord(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function shopsToGeoJSON(shops: ShopPin[]): FC {
  const features: FC["features"] = [];
  for (const shop of shops) {
    const lat = toCoord(shop.latitude);
    const lng = toCoord(shop.longitude);
    if (lat == null || lng == null) continue;
    features.push({
      type: "Feature",
      properties: {
        id: String(shop.id),
        kind: "shop",
        name: shop.name || "",
        street_address: shop.street_address || "",
        city: shop.city || "",
        state: shop.state || "",
        zip_code: shop.zip_code || "",
      },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Draw a glowing red teardrop pin into ImageData (no SVG/CORS issues). */
function createPinImageData(): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const width = 64;
  const height = 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { width, height, data: new Uint8Array(width * height * 4) };
  }

  const cx = width / 2;
  const headY = 34;
  const tipY = height - 6;
  const r = 22;

  // Outer glow
  ctx.beginPath();
  ctx.arc(cx, headY, r + 8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 23, 68, 0.28)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headY, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 82, 82, 0.4)";
  ctx.fill();

  // Soft ground shadow
  ctx.beginPath();
  ctx.ellipse(cx, tipY + 1, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();

  // Pin body
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.bezierCurveTo(cx + 24, headY + 20, cx + r + 1, headY - 4, cx + r, headY);
  ctx.arc(cx, headY, r, 0, Math.PI, true);
  ctx.bezierCurveTo(cx - r - 1, headY - 4, cx - 24, headY + 20, cx, tipY);
  ctx.closePath();

  const body = ctx.createLinearGradient(cx - r, headY - r, cx + r * 0.5, tipY);
  body.addColorStop(0, "#ff8a80");
  body.addColorStop(0.4, "#e53935");
  body.addColorStop(1, "#b71c1c");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();

  // Center hole
  ctx.beginPath();
  ctx.arc(cx, headY - 1, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headY - 1, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#e53935";
  ctx.fill();

  // Specular
  ctx.beginPath();
  ctx.ellipse(cx - 7, headY - 10, 5, 3, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();

  const image = ctx.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: new Uint8Array(image.data),
  };
}

function ensurePinImage(map: mapboxgl.Map): boolean {
  try {
    if (map.hasImage(PIN_IMAGE)) return true;
    map.addImage(PIN_IMAGE, createPinImageData(), { pixelRatio: 2 });
    return map.hasImage(PIN_IMAGE);
  } catch (err) {
    console.error("Pin image failed", err);
    return false;
  }
}

function ensureShopLayers(map: mapboxgl.Map): boolean {
  if (!map.isStyleLoaded()) return false;

  const hasPin = ensurePinImage(map);

  if (!map.getSource(SHOPS_SOURCE)) {
    map.addSource(SHOPS_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer(GLOW_LAYER)) {
    map.addLayer({
      id: GLOW_LAYER,
      type: "circle",
      source: SHOPS_SOURCE,
      paint: {
        "circle-radius": 16,
        "circle-color": "#ff1744",
        "circle-opacity": 0.4,
        "circle-blur": 0.9,
      },
    });
  }

  // Always-visible red dots so shops show even if the pin icon fails
  if (!map.getLayer(DOTS_LAYER)) {
    map.addLayer({
      id: DOTS_LAYER,
      type: "circle",
      source: SHOPS_SOURCE,
      paint: {
        "circle-radius": 6,
        "circle-color": "#e53935",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 1,
      },
    });
  }

  if (hasPin && !map.getLayer(PINS_LAYER)) {
    map.addLayer({
      id: PINS_LAYER,
      type: "symbol",
      source: SHOPS_SOURCE,
      layout: {
        "icon-image": PIN_IMAGE,
        "icon-size": 0.9,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  return true;
}

type LocationsMapProps = {
  pollSales?: boolean;
  className?: string;
  heightClassName?: string;
};

export const LocationsMap = ({
  pollSales = true,
  className,
  heightClassName = "h-[500px]",
}: LocationsMapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const popup = useRef<mapboxgl.Popup | null>(null);
  const didFit = useRef(false);
  const pendingGeo = useRef<FC | null>(null);
  const styleFlushTimer = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [shopCount, setShopCount] = useState(0);
  const [loadHint, setLoadHint] = useState<string | null>(null);

  const applyShopData = useCallback((geo: FC) => {
    const m = map.current;
    if (!m) return;

    try {
      if (!ensureShopLayers(m)) {
        pendingGeo.current = geo;
        return;
      }

      const source = m.getSource(SHOPS_SOURCE) as GeoJSONSource | undefined;
      if (!source) {
        pendingGeo.current = geo;
        return;
      }

      source.setData(geo as GeoJSON.FeatureCollection);
      setShopCount(geo.features.length);
      setLoadHint(geo.features.length === 0 ? "No shops with map coordinates" : null);

      if (!didFit.current && geo.features.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const f of geo.features) bounds.extend(f.geometry.coordinates);
        m.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 0 });
        didFit.current = true;
      }
    } catch (err) {
      console.error("Failed to apply shop markers", err);
      // Keep any count we already know; don't pretend the API failed
      setLoadHint("Map markers failed to draw — try refreshing");
    }
  }, []);

  const fetchAndDisplay = useCallback(async () => {
    if (!map.current) return;

    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

    const loadShops = async (): Promise<ShopPin[]> => {
      try {
        return await api<ShopPin[]>("/shops/map", { timeoutMs: 45_000 });
      } catch {
        return await api<ShopPin[]>("/shops?with_coords_only=true", {
          timeoutMs: 45_000,
        });
      }
    };

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const shops = await loadShops();
        applyShopData(shopsToGeoJSON(shops));
        return;
      } catch (error) {
        lastError = error;
        console.error(`Shop map fetch attempt ${attempt + 1} failed`, error);
        if (attempt < 2) await sleep(800 * (attempt + 1));
      }
    }

    const msg =
      typeof lastError === "object" &&
      lastError &&
      "message" in lastError &&
      typeof (lastError as { message: unknown }).message === "string"
        ? (lastError as { message: string }).message
        : "Could not load shop locations";
    setShopCount(0);
    setLoadHint(msg);
  }, [applyShopData]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setMapError("Mapbox token missing. Set VITE_MAPBOX_TOKEN in your environment.");
      setLoading(false);
      return;
    }

    if (!mapContainer.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    didFit.current = false;

    try {
      const m = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-87.7, 41.8],
        zoom: 7,
        antialias: false,
        fadeDuration: 0,
        renderWorldCopies: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.current = m;
      popup.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 22,
        maxWidth: "260px",
      });

      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      m.on("styleimagemissing", (e) => {
        if (e.id === PIN_IMAGE) ensurePinImage(m);
      });

      const flushPending = () => {
        ensureShopLayers(m);
        if (pendingGeo.current) {
          const geo = pendingGeo.current;
          pendingGeo.current = null;
          applyShopData(geo);
        }
      };

      const onReady = () => {
        try {
          ensureShopLayers(m);
          flushPending();
          setLoading(false);
          void fetchAndDisplay();
        } catch (err) {
          console.error(err);
          setMapError("Failed to set up map pins");
          setLoading(false);
        }
      };

      if (m.isStyleLoaded()) onReady();
      else m.once("load", onReady);

      m.on("styledata", () => {
        if (!m.isStyleLoaded()) return;
        // Throttle — styledata fires very often and can starve fetch work
        if (styleFlushTimer.current) window.clearTimeout(styleFlushTimer.current);
        styleFlushTimer.current = window.setTimeout(() => {
          flushPending();
        }, 100);
      });

      m.on("error", (e) => {
        console.error("Mapbox error", e);
        if (!m.isStyleLoaded()) {
          const msg =
            (e as { error?: { message?: string } })?.error?.message ||
            "Map failed to load. Check the Mapbox token and URL restrictions.";
          setMapError(msg);
          setLoading(false);
        }
      });

      const showShopPopup = (
        e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }
      ) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const props = f.properties || {};
        popup.current
          ?.setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="padding:8px;min-width:140px;">
              <div style="font-size:11px;color:#e53935;font-weight:600;margin-bottom:2px;">Shop</div>
              <h3 style="font-weight:600;margin-bottom:4px;">${escapeHtml(String(props.name || ""))}</h3>
              <p style="font-size:12px;color:#666;">${formatShopAddress(props)}</p>
            </div>`
          )
          .addTo(m);
      };

      m.on("click", PINS_LAYER, showShopPopup);
      m.on("click", DOTS_LAYER, showShopPopup);

      for (const layer of [PINS_LAYER, DOTS_LAYER]) {
        m.on("mouseenter", layer, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
        });
      }

      // Always retry periodically so a transient /api blip doesn't stick forever
      const interval = window.setInterval(() => {
        void fetchAndDisplay();
      }, pollSales ? POLL_MS : 60_000);

      const onShopsChanged = () => {
        void fetchAndDisplay();
      };
      window.addEventListener("shops-changed", onShopsChanged);

      const resize = () => m.resize();
      window.requestAnimationFrame(resize);
      window.addEventListener("resize", resize);

      return () => {
        window.clearInterval(interval);
        if (styleFlushTimer.current) window.clearTimeout(styleFlushTimer.current);
        window.removeEventListener("shops-changed", onShopsChanged);
        window.removeEventListener("resize", resize);
        popup.current?.remove();
        m.remove();
        map.current = null;
      };
    } catch (error) {
      console.error("Error initializing map:", error);
      setMapError("Failed to initialize map");
      setLoading(false);
    }
  }, [applyShopData, fetchAndDisplay, pollSales]);

  return (
    <Card className={`relative w-full overflow-hidden ${heightClassName} ${className || ""}`}>
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
        <>
          <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "400px" }} />
          <div className="absolute bottom-3 left-3 z-10 rounded-md bg-background/95 border px-3 py-2 text-xs shadow-sm space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="relative inline-block h-4 w-3 shrink-0"
                aria-hidden
              >
                <span
                  className="absolute inset-x-0 top-0 mx-auto h-3 w-3 rounded-full bg-[#e53935]"
                  style={{
                    boxShadow: "0 0 6px 2px rgba(229,57,53,0.75)",
                    background:
                      "radial-gradient(circle at 50% 45%, #fff 28%, #e53935 32%)",
                  }}
                />
                <span
                  className="absolute left-1/2 bottom-0 h-2 w-2 -translate-x-1/2 bg-[#e53935]"
                  style={{
                    clipPath: "polygon(50% 100%, 0 0, 100% 0)",
                    filter: "drop-shadow(0 0 3px rgba(229,57,53,0.8))",
                  }}
                />
              </span>
              <span>Shops ({shopCount})</span>
            </div>
            {loadHint ? (
              <div className="pt-0.5 space-y-1">
                <p className="text-[10px] text-destructive">{loadHint}</p>
                <button
                  type="button"
                  className="text-[10px] font-medium text-primary underline underline-offset-2"
                  onClick={() => {
                    setLoadHint("Retrying…");
                    void fetchAndDisplay();
                  }}
                >
                  Retry loading shops
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground pt-0.5">
                Glowing red pins are shops
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
};

export const SalesMap = LocationsMap;
