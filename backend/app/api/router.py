from fastapi import APIRouter

from app.api.routes import (
    ai,
    analytics,
    auth,
    bulk,
    dashboard,
    invoices,
    locations,
    orders,
    products,
    retailer_signups,
    shops,
    support_tickets,
    users,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(products.router)
api_router.include_router(shops.router)
api_router.include_router(invoices.router)
api_router.include_router(orders.router)
api_router.include_router(dashboard.router)
api_router.include_router(users.router)
api_router.include_router(locations.router)
api_router.include_router(analytics.router)
api_router.include_router(bulk.router)
api_router.include_router(retailer_signups.router)
api_router.include_router(ai.router)
api_router.include_router(support_tickets.router)
