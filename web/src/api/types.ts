// Shapes of the JSON the API returns. IDs are strings because PostgreSQL BIGINTs
// arrive as strings (they can exceed JavaScript's safe integer range).

export type Role = 'customer' | 'admin' | 'rider';
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  store_id: string | null; // riders: the store they work for
  phone: string | null;
  email_verified: boolean;
  must_verify_email: boolean; // this server blocks checkout until the email is confirmed
};

export type Store = {
  id: string;
  name: string;
  city: string;
  pincode: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  radius_km: number;
};

export type NearbyStore = Store & { distance_km: number; delivers: boolean };
export type NearestResult = {
  point: { lat: number; lng: number; pincode: string | null; area: string | null; city: string | null };
  stores: NearbyStore[];
};

export type Address = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  phone: string;
  lat: number;
  lng: number;
  is_default: boolean;
};
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

export type OrderStatus = 'PENDING_PAYMENT' | 'PLACED' | 'PACKED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type PaymentMethod = 'cod' | 'online';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refund_pending' | 'refunded';

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
  phone: string | null;
  created_at: string;
  store_id: string;
  store_name: string;
  slot_start: string;
  slot_end: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_expires_at: string | null;
  rider_name: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  items: OrderItem[];
};

export type PlacedOrder = {
  orderId: string;
  status: OrderStatus;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  paymentExpiresAt: string | null;
};

/** What POST /orders/:id/payment returns: enough to open the payment window */
export type PaymentStart = {
  provider: 'razorpay' | 'fake';
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
  expiresAt: string | null;
  prefill: { name: string; email: string; contact: string };
};
/** What the payment window returns on success (Razorpay's field names) */
export type PaymentSuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

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
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  rider_name: string | null;
};

export type Rider = {
  id: string;
  name: string;
  email: string;
  store_id: string;
  store_name: string;
  on_the_way: number;
  delivered_today: number;
};

// ---- rider ----
export type RiderOrder = {
  id: string;
  status: OrderStatus;
  total_paise: number;
  address: string;
  phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  picked_up_at: string | null;
  slot_start: string;
  slot_end: string;
  customer_name: string;
  item_count: number;
};
export type RiderBoard = {
  store: { id: string; name: string; address: string | null; lat: number | null; lng: number | null };
  ready: RiderOrder[];
  mine: RiderOrder[];
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
