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


class SignInRequest(BaseModel):
    email: EmailStr
    password: str


class ProductCreate(BaseModel):
    name: str
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
    is_frozen: bool
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class InvoiceItemIn(BaseModel):
    product_id: UUID
    product_name: str
    quantity: int = Field(ge=1)
    unit_price: float
    subtotal: float


class InvoiceCreate(BaseModel):
    shop_id: UUID
    items: list[InvoiceItemIn]
    discount_amount: float = 0
    notes: str | None = None
    warehouse: WarehouseCode | None = WarehouseCode.A


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
    items: list["InvoiceItemOut"] = []


class InvoiceItemOut(ORMModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class PaymentCreate(BaseModel):
    invoice_id: UUID
    amount: float = Field(gt=0)
    payment_method: PaymentMethod
    payment_date: date
    check_number: str | None = None
    notes: str | None = None


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


class DashboardStats(BaseModel):
    products_count: int
    shops_count: int
    invoices_count: int
    total_revenue: float
    collection_rate: float


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


InvoiceOut.model_rebuild()
