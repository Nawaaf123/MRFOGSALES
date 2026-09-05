"""Mapbox forward geocoding helpers for shop addresses."""
from __future__ import annotations

from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.models import Shop


def shop_address_query(shop: Shop) -> str:
    parts = [
        shop.street_address,
        shop.street_address_line_2,
        shop.city,
        shop.state,
        shop.zip_code,
    ]
    return ", ".join(part.strip() for part in parts if part and str(part).strip())


def geocode_address(query: str) -> tuple[float, float] | None:
    """Return (latitude, longitude) or None if lookup fails / not configured."""
    settings = get_settings()
    token = (settings.mapbox_access_token or "").strip()
    if not token or not query.strip():
        return None

    url = (
        "https://api.mapbox.com/geocoding/v5/mapbox.places/"
        f"{quote(query.strip())}.json"
    )
    try:
        response = httpx.get(
            url,
            params={"access_token": token, "limit": 1},
            timeout=20.0,
        )
        if response.status_code >= 400:
            return None
        features = response.json().get("features") or []
        if not features:
            return None
        center = features[0].get("center")
        if not center or len(center) < 2:
            return None
        lng, lat = float(center[0]), float(center[1])
        return lat, lng
    except Exception:  # noqa: BLE001
        return None


def apply_geocode_if_needed(shop: Shop, *, force: bool = False) -> bool:
    """
    Set shop.latitude/longitude from address when missing (or force=True).
    Returns True if coordinates were set/updated.
    """
    if (
        not force
        and shop.latitude is not None
        and shop.longitude is not None
    ):
        return False
    query = shop_address_query(shop)
    if not query:
        return False
    coords = geocode_address(query)
    if not coords:
        return False
    shop.latitude, shop.longitude = coords
    return True
