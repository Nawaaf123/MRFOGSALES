import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LocationsMap = lazy(() =>
  import("@/components/location/SalesMap").then((m) => ({ default: m.LocationsMap }))
);

type DeferredLocationsMapProps = {
  heightClassName?: string;
  pollSales?: boolean;
  /** Extra classes on the outer shell (placeholder + map). */
  className?: string;
  /** Shown above the map area (title row lives in the parent). */
  fallbackHeightClassName?: string;
};

/**
 * Loads Mapbox only after the section is near the viewport, or the user taps Load map.
 * Avoids pulling the ~1.6MB map bundle on every Shops/Dashboard visit.
 */
export function DeferredLocationsMap({
  heightClassName = "h-[320px] md:h-[420px]",
  pollSales = true,
  className,
  fallbackHeightClassName,
}: DeferredLocationsMapProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [forceLoad, setForceLoad] = useState(false);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || nearViewport) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearViewport(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px 0px", threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nearViewport]);

  const shouldLoad = nearViewport || forceLoad;
  const placeholderHeight = fallbackHeightClassName || heightClassName;

  let body: ReactNode;
  if (!shouldLoad) {
    body = (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-primary/20 bg-muted/20 px-4 text-center",
          placeholderHeight
        )}
      >
        <p className="text-sm text-muted-foreground">
          Map loads when you scroll here — or tap below
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 border-primary/30"
          onClick={() => setForceLoad(true)}
        >
          <MapIcon className="mr-2 h-4 w-4" />
          Load map
        </Button>
      </div>
    );
  } else {
    body = (
      <Suspense
        fallback={
          <div
            className={cn(
              "flex items-center justify-center rounded-lg border text-sm text-muted-foreground",
              placeholderHeight
            )}
          >
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading map…
          </div>
        }
      >
        <LocationsMap heightClassName={heightClassName} pollSales={pollSales} />
      </Suspense>
    );
  }

  return (
    <div ref={shellRef} className={className}>
      {body}
    </div>
  );
}
