from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
    AppRole,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    WarehouseCode,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(ORMModel):
    id: UUID
    email: EmailStr
    full_name: str
    role: AppRole
    assigned_warehouse: WarehouseCode
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1)
    role: AppRole = AppRole.sales
    assigned_warehouse: WarehouseCode = WarehouseCode.A


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    role: AppRole | None = None
    assigned_warehouse: WarehouseCode | None = None
    full_name: str | None = None
    is_active: bool | None = None


class ProductCreate(BaseModel):
    name: str
    sku: str | None = None
    category: str = "General"
    subcategory: str | None = None
    sub_subcategory: str | None = None
    price: float = 0
    stock_quantity: int = 0
    stock_quantity_b: int = 0
    low_stock_threshold: int = 10
    image_url: str | None = None
    is_active: bool = True


class ProductUpdate(BaseModel):
    name: str | None = None
    sku: str | None = None
    category: str | None = None
    subcategory: str | None = None
    sub_subcategory: str | None = None
    price: float | None = None
    stock_quantity: int | None = None
    stock_quantity_b: int | None = None
    low_stock_threshold: int | None = None
    image_url: str | None = None
    is_active: bool | None = None


class ProductOut(ORMModel):
    id: UUID
    name: str
    sku: str | None = None
    category: str
    subcategory: str | None
    sub_subcategory: str | None
    price: float
    stock_quantity: int
    stock_quantity_b: int
    low_stock_threshold: int
    image_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProductBrief(ORMModel):
    id: UUID
    name: str
    sku: str | None = None
    category: str
    subcategory: str | None = None
    price: float


class ShopCreate(BaseModel):
    name: str
    owner_name: str | None = None
    email: str | None = None
    phone: str | None = None
    street_address: str | None = None
    street_address_line_2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    is_frozen: bool = False


class ShopUpdate(BaseModel):
    name: str | None = None
    owner_name: str | None = None
    email: str | None = None
    phone: str | None = None
    street_address: str | None = None
    street_address_line_2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    is_frozen: bool | None = None


class ShopOut(ORMModel):
    id: UUID
    name: str
    owner_name: str | None
    email: str | None
    phone: str | None
    street_address: str | None
    street_address_line_2: str | None
    city: str | None
    state: str | None
    zip_code: str | None
    latitude: float | None = None
    longitude: float | None = None
    is_frozen: bool
    created_by: UUID | None
    retailer_user_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ShopBrief(ORMModel):
    id: UUID
    name: str
    owner_name: str | None = None
    phone: str | None = None
    email: str | None = None
    street_address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class GeocodeMissingResult(BaseModel):
    attempted: int
    updated: int
    skipped: int
    remaining: int = 0
    errors: list[str] = []


class InvoiceItemIn(BaseModel):
    product_id: UUID
    product_name: str
    quantity: int = Field(ge=1)
    unit_price: float
    subtotal: float


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    payment_method: PaymentMethod
    payment_date: date | None = None
    check_number: str | None = None
    notes: str | None = None


class InvoiceCreate(BaseModel):
    shop_id: UUID
    items: list[InvoiceItemIn]
    discount_amount: float = 0
    notes: str | None = None
    warehouse: WarehouseCode | None = WarehouseCode.A
    payments: list[PaymentIn] = []
    # Same id on retry/double-submit returns the original invoice (no duplicate).
    # Stored as string; accept any non-empty client token up to 64 chars (not only UUID).
    client_request_id: str | None = Field(default=None, max_length=64)


class InvoiceItemOut(ORMModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class PaymentOut(ORMModel):
    id: UUID
    invoice_id: UUID
    amount: float
    payment_method: PaymentMethod
    payment_date: date
    check_number: str | None
    notes: str | None
    created_by: UUID
    created_at: datetime


class InvoiceOut(ORMModel):
    id: UUID
    invoice_number: str
    shop_id: UUID
    created_by: UUID | None
    total_amount: float
    discount_amount: float
    payment_status: PaymentStatus
    notes: str | None
    warehouse: WarehouseCode | None
    created_at: datetime
    updated_at: datetime
    items: list[InvoiceItemOut] = []
    payments: list[PaymentOut] = []
    shop: ShopBrief | None = None
    amount_paid: float = 0


class InvoiceListOut(ORMModel):
    """Lean list row — no nested items/payments (load detail via GET /invoices/{id})."""

    id: UUID
    invoice_number: str
    shop_id: UUID
    created_by: UUID | None
    total_amount: float
    discount_amount: float
    payment_status: PaymentStatus
    notes: str | None = None
    warehouse: WarehouseCode | None = None
    created_at: datetime
    updated_at: datetime | None = None
    shop: ShopBrief | None = None
    amount_paid: float = 0


class PaymentCreate(BaseModel):
    invoice_id: UUID
    amount: float = Field(gt=0)
    payment_method: PaymentMethod
    payment_date: date
    check_number: str | None = None
    notes: str | None = None


class OrderItemIn(BaseModel):
    product_id: UUID
    product_name: str
    quantity: int = Field(ge=1)
    unit_price: float
    subtotal: float


class OrderCreate(BaseModel):
    shop_id: UUID
    items: list[OrderItemIn]
    notes: str | None = None
    warehouse: WarehouseCode | None = WarehouseCode.A


class OrderItemOut(ORMModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class OrderOut(ORMModel):
    id: UUID
    shop_id: UUID
    created_by: UUID
    status: OrderStatus
    total_amount: float
    notes: str | None
    admin_notes: str | None
    invoice_id: UUID | None
    warehouse: WarehouseCode | None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut] = []
    shop: ShopBrief | None = None


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    admin_notes: str | None = None
    warehouse: WarehouseCode | None = None


class OrderApproveResponse(BaseModel):
    order: OrderOut
    invoice: InvoiceOut


class DashboardStats(BaseModel):
    products_count: int
    shops_count: int
    invoices_count: int
    total_revenue: float
    collection_rate: float
    pending_orders: int = 0
    unpaid_invoices: int = 0


class AnalyticsOverview(BaseModel):
    invoice_count: int
    revenue: float
    discounts: float
    collected: float
    collection_rate: float
    paid_count: int
    unpaid_count: int
    partial_count: int
    unique_shops: int
    units_sold: int
    average_invoice: float


class ProductSalesRow(BaseModel):
    product_name: str
    total_quantity: int
    total_revenue: float


class ShopSalesRow(BaseModel):
    shop_name: str
    invoice_count: int
    total_revenue: float


class CategorySalesRow(BaseModel):
    category: str
    total_quantity: int
    total_revenue: float


class DailySalesRow(BaseModel):
    date: str
    invoice_count: int
    revenue: float


class SalesPersonPerformance(BaseModel):
    user_id: UUID
    full_name: str
    email: EmailStr
    invoice_count: int
    total_revenue: float
    unique_shops: int
    average_invoice: float
    commission: float


class LegacyBalanceCreate(BaseModel):
    shop_id: UUID
    amount: float = Field(gt=0)
    notes: str | None = None


class InvoiceEmailRequest(BaseModel):
    to: EmailStr | None = None
    pdf_base64: str = Field(min_length=1)


class DistributePaymentRequest(BaseModel):
    shop_id: UUID
    amount: float = Field(gt=0)
    payment_method: PaymentMethod
    payment_date: date | None = None
    check_number: str | None = None
    notes: str | None = None


class DistributePaymentResult(BaseModel):
    payments_created: int
    amount_applied: float


class RetailerSignupCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    phone: str | None = None
    requested_shop_name: str = Field(min_length=1)
    message: str | None = None
    password: str = Field(min_length=6)


class RetailerSignupOut(ORMModel):
    id: UUID
    email: EmailStr
    full_name: str
    phone: str | None
    requested_shop_name: str
    message: str | None
    status: str
    shop_id: UUID | None
    user_id: UUID | None
    created_at: datetime
    reviewed_at: datetime | None


class RetailerSignupApprove(BaseModel):
    shop_id: UUID


class LowStockProduct(ORMModel):
    id: UUID
    name: str
    category: str
    stock_quantity: int
    stock_quantity_b: int
    low_stock_threshold: int
    total_stock: int


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None


class LocationOut(ORMModel):
    id: UUID
    user_id: UUID
    latitude: float
    longitude: float
    accuracy: float | None
    updated_at: datetime
    full_name: str | None = None
    email: str | None = None


class SuggestOrderRequest(BaseModel):
    shop_id: UUID
    limit: int = Field(default=10, ge=1, le=30)


class SuggestOrderItem(BaseModel):
    product_id: UUID
    product_name: str
    sku: str | None = None
    quantity: int
    unit_price: float
    reason: str | None = None


class SuggestOrderResponse(BaseModel):
    items: list[SuggestOrderItem]
    shop_id: UUID
    note: str | None = None


class AiChatMessage(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    messages: list[AiChatMessage] = Field(default_factory=list, max_length=20)


class AiChatResponse(BaseModel):
    reply: str
