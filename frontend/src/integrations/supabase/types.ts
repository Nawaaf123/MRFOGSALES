export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      invoice_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          product_id: string
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          product_id: string
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          discount_amount: number | null
          id: string
          invoice_number: string
          notes: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shop_id: string
          total_amount: number
          updated_at: string
          warehouse: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          id?: string
          invoice_number: string
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shop_id: string
          total_amount: number
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          id?: string
          invoice_number?: string
          notes?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shop_id?: string
          total_amount?: number
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          subtotal: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          admin_notes: string | null
          created_at: string
          created_by: string
          id: string
          invoice_id: string | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
          updated_at: string
          warehouse: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          created_by: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_id: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_amount?: number
          updated_at?: string
          warehouse?: Database["public"]["Enums"]["warehouse_code"] | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          check_number: string | null
          created_at: string
          created_by: string
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Insert: {
          amount: number
          check_number?: string | null
          created_at?: string
          created_by: string
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Update: {
          amount?: number
          check_number?: string | null
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          low_stock_threshold: number
          name: string
          price: number
          stock_quantity: number
          stock_quantity_b: number
          sub_subcategory: string | null
          subcategory: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          price: number
          stock_quantity?: number
          stock_quantity_b?: number
          sub_subcategory?: string | null
          subcategory?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          price?: number
          stock_quantity?: number
          stock_quantity_b?: number
          sub_subcategory?: string | null
          subcategory?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_warehouse: Database["public"]["Enums"]["warehouse_code"]
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          assigned_warehouse?: Database["public"]["Enums"]["warehouse_code"]
          created_at?: string
          email: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          assigned_warehouse?: Database["public"]["Enums"]["warehouse_code"]
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      retailer_signup_requests: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          message: string | null
          phone: string | null
          requested_shop_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          shop_id: string | null
          status: Database["public"]["Enums"]["signup_request_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          message?: string | null
          phone?: string | null
          requested_shop_name: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_id?: string | null
          status?: Database["public"]["Enums"]["signup_request_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          phone?: string | null
          requested_shop_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shop_id?: string | null
          status?: Database["public"]["Enums"]["signup_request_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retailer_signup_requests_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_frozen: boolean
          name: string
          owner_name: string | null
          phone: string | null
          retailer_user_id: string | null
          state: string | null
          street_address: string | null
          street_address_line_2: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_frozen?: boolean
          name: string
          owner_name?: string | null
          phone?: string | null
          retailer_user_id?: string | null
          state?: string | null
          street_address?: string | null
          street_address_line_2?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_frozen?: boolean
          name?: string
          owner_name?: string | null
          phone?: string | null
          retailer_user_id?: string | null
          state?: string | null
          street_address?: string | null
          street_address_line_2?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      user_locations: {
        Row: {
          accuracy: number | null
          created_at: string
          id: string
          latitude: number
          longitude: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accuracy?: number | null
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accuracy?: number | null
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_retailer_signup: {
        Args: { p_request_id: string; p_shop_id: string }
        Returns: undefined
      }
      generate_invoice_number: { Args: never; Returns: string }
      get_database_size: {
        Args: never
        Returns: {
          total_bytes: number
          total_size: string
        }[]
      }
      get_sales_by_category: {
        Args: never
        Returns: {
          category: string
          product_name: string
          total_quantity: number
        }[]
      }
      get_top_products: {
        Args: { limit_count?: number }
        Returns: {
          product_name: string
          total_quantity: number
        }[]
      }
      get_top_shops: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: {
          shop_name: string
          total_revenue: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      update_invoice_atomic: {
        Args: {
          p_discount_amount: number
          p_invoice_id: string
          p_items: Json
          p_notes: string
          p_shop_id: string
          p_total_amount: number
        }
        Returns: string
      }
      update_product_stock:
        | {
            Args: { p_product_id: string; p_quantity: number }
            Returns: undefined
          }
        | {
            Args: {
              p_product_id: string
              p_quantity: number
              p_warehouse?: string
            }
            Returns: undefined
          }
      update_product_stock_batch: {
        Args: { p_items: Json; p_warehouse?: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "sales" | "srour" | "retailer"
      order_status: "pending" | "approved" | "rejected" | "converted"
      payment_method: "cash" | "check" | "credit"
      payment_status: "paid" | "partial" | "unpaid"
      signup_request_status: "pending" | "approved" | "rejected"
      warehouse_code: "A" | "B"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sales", "srour", "retailer"],
      order_status: ["pending", "approved", "rejected", "converted"],
      payment_method: ["cash", "check", "credit"],
      payment_status: ["paid", "partial", "unpaid"],
      signup_request_status: ["pending", "approved", "rejected"],
      warehouse_code: ["A", "B"],
    },
  },
} as const
