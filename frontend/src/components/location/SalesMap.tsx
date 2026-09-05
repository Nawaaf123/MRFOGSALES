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
const SALES_SOURCE = "sales-src";
const PIN_IMAGE = "shop-pin-red";

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

function shopsToGeoJSON(shops: ShopPin[]): FC {
  return {
    type: "FeatureCollection",
    features: shops
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((shop) => ({
        type: "Feature" as const,
        properties: {
          id: shop.id,
          kind: "shop",
          name: shop.name,
          street_address: shop.street_address || "",
          city: shop.city || "",
          state: shop.state || "",
          zip_code: shop.zip_code || "",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [shop.longitude as number, shop.latitude as number],
        },
      })),
  };
}

function salesToGeoJSON(locations: SalesLocation[]): FC {
  return {
    type: "FeatureCollection",
    features: locations.map((loc) => ({
      type: "Feature" as const,
      properties: {
        id: loc.user_id,
        kind: "sales",
        name: loc.full_name || "Unknown",
        email: loc.email || "",
        updated_at: loc.updated_at,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [loc.longitude, loc.latitude],
      },
    })),
  };
}

/** Classic glossy teardrop pin (red) with circular hole — like a location marker. */
function createPinImageData(): ImageData {
  const width = 96;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(width, height);

  const cx = width / 2;
  const headY = 46;
  const tipY = height - 4;
  const r = 34;

  // Soft ground shadow under tip
  ctx.beginPath();
  ctx.ellipse(cx, tipY, 14, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fill();

  // Classic map-pin silhouette (round head → sharp tip)
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.bezierCurveTo(cx + 36, headY + 28, cx + r + 2, headY - 8, cx + r, headY);
  ctx.arc(cx, headY, r, 0, Math.PI, true);
  ctx.bezierCurveTo(cx - r - 2, headY - 8, cx - 36, headY + 28, cx, tipY);
  ctx.closePath();

  const body = ctx.createLinearGradient(cx - r, headY - r, cx + r * 0.6, tipY);
  body.addColorStop(0, "#ff7a7a");
  body.addColorStop(0.28, "#f44336");
  body.addColorStop(0.65, "#d32f2f");
  body.addColorStop(1, "#b71c1c");
  ctx.fillStyle = body;
  ctx.fill();

  // Soft edge highlight
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.stroke();

  // Punch circular hole through the head
  const holeR = 12;
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, headY - 1, holeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Hole rim (inner edge catch-light)
  ctx.beginPath();
  ctx.arc(cx, headY - 1, holeR, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, headY - 1, holeR, 0.2, Math.PI * 0.9);
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Specular gloss on upper-left of head
  ctx.beginPath();
  ctx.ellipse(cx - 12, headY - 16, 9, 5, -0.55, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fill();

  return ctx.getImageData(0, 0, width, height);
}

function ensurePinImage(map: mapboxgl.Map) {
  if (!map.hasImage(PIN_IMAGE)) {
    map.addImage(PIN_IMAGE, createPinImageData(), { pixelRatio: 2 });
  }
}

function ensureLayers(map: mapboxgl.Map) {
  ensurePinImage(map);

  if (!map.getSource(SHOPS_SOURCE)) {
    map.addSource(SHOPS_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      // No clustering — keeps every pin visible while still using fast GL layers
    });

    // Tiny anchor under pin tip (helps hit-testing); pin icon is the main marker
    map.addLayer({
      id: "shops-circles",
      type: "circle",
      source: SHOPS_SOURCE,
      paint: {
        "circle-radius": 3,
        "circle-color": "#e53935",
        "circle-stroke-width": 0,
        "circle-opacity": 0.01,
      },
    });

    map.addLayer({
      id: "shops-pins",
      type: "symbol",
      source: SHOPS_SOURCE,
      layout: {
        "icon-image": PIN_IMAGE,
        "icon-size": 0.55,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  if (!map.getSource(SALES_SOURCE)) {
    map.addSource(SALES_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "sales-dots",
      type: "circle",
      source: SALES_SOURCE,
      paint: {
        "circle-radius": 8,
        "circle-color": "#2563eb",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }
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
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ shops: 0, sales: 0 });

  const fetchAndDisplay = useCallback(async () => {
    const m = map.current;
    if (!m) return;

    try {
      // Do not gate on isStyleLoaded() — in Mapbox GL v3 it can stay false and skip all data.
      ensureLayers(m);

      let shops: ShopPin[] = [];
      try {
        shops = await api<ShopPin[]>("/shops/map");
      } catch {
        shops = await api<ShopPin[]>("/shops?with_coords_only=true");
      }

      let locations: SalesLocation[] = [];
      try {
        locations = await api<SalesLocation[]>("/locations");
      } catch {
        // Sales GPS list is admin-only; shops must still render for other roles.
        locations = [];
      }

      const shopsGeo = shopsToGeoJSON(shops);
      const salesGeo = salesToGeoJSON(locations);

      const shopsSource = m.getSource(SHOPS_SOURCE) as GeoJSONSource | undefined;
      const salesSource = m.getSource(SALES_SOURCE) as GeoJSONSource | undefined;
      if (!shopsSource || !salesSource) {
        ensureLayers(m);
      }
      (m.getSource(SHOPS_SOURCE) as GeoJSONSource | undefined)?.setData(
        shopsGeo as GeoJSON.FeatureCollection
      );
      (m.getSource(SALES_SOURCE) as GeoJSONSource | undefined)?.setData(
        salesGeo as GeoJSON.FeatureCollection
      );

      setCounts({ shops: shopsGeo.features.length, sales: salesGeo.features.length });

      if (!didFit.current && shopsGeo.features.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const f of shopsGeo.features) bounds.extend(f.geometry.coordinates);
        for (const f of salesGeo.features) bounds.extend(f.geometry.coordinates);
        m.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 0 });
        didFit.current = true;
      }
    } catch (error) {
      console.error("Error fetching map locations:", error);
      setCounts({ shops: 0, sales: 0 });
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
        offset: 18,
        maxWidth: "260px",
      });

      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      const onReady = () => {
        try {
          ensureLayers(m);
          setLoading(false);
          // Defer one frame so the style/sources are fully attached before setData
          window.requestAnimationFrame(() => {
            void fetchAndDisplay();
          });
        } catch (err) {
          console.error(err);
          setMapError("Failed to set up map layers");
          setLoading(false);
        }
      };

      if (m.isStyleLoaded()) onReady();
      else m.once("load", onReady);

      m.on("error", (e) => {
        console.error("Mapbox error", e);
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

      m.on("click", "shops-pins", showShopPopup);
      m.on("click", "shops-circles", showShopPopup);

      m.on("click", "sales-dots", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const props = f.properties || {};
        const updated = props.updated_at
          ? new Date(String(props.updated_at)).toLocaleString()
          : "";
        popup.current
          ?.setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="padding:8px;min-width:140px;">
              <div style="font-size:11px;color:#2563eb;font-weight:600;margin-bottom:2px;">Sales</div>
              <h3 style="font-weight:600;margin-bottom:4px;">${escapeHtml(String(props.name || "Unknown"))}</h3>
              <p style="font-size:12px;color:#666;margin-bottom:4px;">${escapeHtml(String(props.email || ""))}</p>
              <p style="font-size:11px;color:#999;">Last updated: ${escapeHtml(updated)}</p>
            </div>`
          )
          .addTo(m);
      });

      for (const layer of ["shops-pins", "shops-circles", "sales-dots"]) {
        m.on("mouseenter", layer, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
        });
      }

      const interval = pollSales
        ? window.setInterval(() => {
            void fetchAndDisplay();
          }, POLL_MS)
        : undefined;

      const onShopsChanged = () => {
        void fetchAndDisplay();
      };
      window.addEventListener("shops-changed", onShopsChanged);

      return () => {
        if (interval) window.clearInterval(interval);
        window.removeEventListener("shops-changed", onShopsChanged);
        popup.current?.remove();
        m.remove();
        map.current = null;
      };
    } catch (error) {
      console.error("Error initializing map:", error);
      setMapError("Failed to initialize map");
      setLoading(false);
    }
  }, [fetchAndDisplay, pollSales]);

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
                    boxShadow: "inset 0 0 0 4px #e53935, inset 0 0 0 6px transparent",
                    background:
                      "radial-gradient(circle at 50% 45%, transparent 32%, #e53935 34%)",
                  }}
                />
                <span
                  className="absolute left-1/2 bottom-0 h-2 w-2 -translate-x-1/2 bg-[#e53935]"
                  style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
                />
              </span>
              <span>Shops ({counts.shops})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[#2563eb] border border-white" />
              <span>Sales team ({counts.sales})</span>
            </div>
            <p className="text-[10px] text-muted-foreground pt-0.5">
              Red pins are shops · blue dots are sales GPS
            </p>
          </div>
        </>
      )}
    </Card>
  );
};

export const SalesMap = LocationsMap;
