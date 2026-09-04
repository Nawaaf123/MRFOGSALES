from fastapi import APIRouter

from app.api.routes import auth, dashboard, invoices, locations, orders, products, shops, users

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(products.router)
api_router.include_router(shops.router)
api_router.include_router(invoices.router)
api_router.include_router(orders.router)
api_router.include_router(dashboard.router)
api_router.include_router(users.router)
api_router.include_router(locations.router)
