// Shapes of the JSON the API returns. IDs are strings because PostgreSQL BIGINTs
// arrive as strings (they can exceed JavaScript's safe integer range).

export type Role = 'customer' | 'admin';
export type User = { id: string; email: string; name: string; role: Role };

export type Store = { id: string; name: string; city: string; pincode: string };
export type Category = { id: string; name: string; slug: string };

export type Product = {
  id: string;
  name: string;
  unit: string;
  image_url: string | null;
  category: string;
  price_paise: number;
  in_stock: boolean;
  low_stock: number | null; // a count only when 5 or fewer are left
};
export type ProductPage = { items: Product[]; nextCursor: string | null };

export type Slot = { id: string; starts_at: string; ends_at: string; free: number };

export type OrderStatus = 'PLACED' | 'PACKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export type OrderItem = {
  productId: number;
  name: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  total_paise: number;
  address: string;
  created_at: string;
  store_id: string;
  store_name: string;
  slot_start: string;
  slot_end: string;
  items: OrderItem[];
};

export type PlacedOrder = { orderId: string; status: OrderStatus; totalPaise: number };

// ---- admin ----
export type AdminOrder = {
  id: string;
  status: OrderStatus;
  total_paise: number;
  created_at: string;
  store_id: string;
  store_name: string;
  customer_email: string;
  slot_start: string;
  item_count: number;
};

export type InventoryRow = {
  product_id: string;
  name: string;
  image_url: string | null;
  unit: string;
  category: string;
  price_paise: number;
  stock: number;
  is_listed: boolean;
  updated_at: string;
};
export type InventoryPage = { items: InventoryRow[]; nextAfterId: number | null };

export type SalesRow = {
  store_id: string;
  store: string;
  day: string;
  orders: number;
  revenue_paise: number;
};
export type TopProduct = { product_id: string; name: string; units_sold: number; revenue_paise: number };
export type SlotUse = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  utilisation_pct: number;
};
