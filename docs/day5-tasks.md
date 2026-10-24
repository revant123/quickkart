# Day 5 — the website

New today: the React shop in `web/`. Customers can browse, search, fill a cart, check out
and track or cancel orders. Admins get a dashboard for orders, stock, delivery slots and sales.

Also changed:
- **New sample data**: every product now fits its aisle ("Malai paneer, 200 g" in Dairy).
- **Browsing order**: with no search, the shop lists products in catalogue order, so the
  first page mixes aisles. Searches are still A to Z.

You need **three terminal tabs** today: the API (node tab), the website (new tab), and one
for commands (zsh tab). Open a new tab with the **+** at the top right of the terminal panel.

---

## Task 1 — Restart the API (1 min)

The product list changed. In the **node** tab: **Ctrl+C**, then `npm run dev`.

## Task 2 — Load the new sample data (1 min)

In the **zsh** tab, from the `quickkart` folder:
```bash
bash scripts/reset-data.sh
```
This **wipes everything** (including test accounts and orders) and loads fresh, realistic
products. You'll register again in Task 4. If delivery slots ever run out later:
```bash
docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql
```

## Task 3 — Start the website (3 min)

Open a **new terminal tab** (+), then:
```bash
cd web
npm install
npm run dev
```
When you see `Local: http://localhost:5173/`, open **http://localhost:5173** in your browser.
Leave this tab running, like the API tab.

## Task 4 — Shop as a customer (10 min)

1. Browse. Switch aisles with the chips. Search "paneer". Click **Load more**.
2. Change the store at the top ("Delivering from"). Prices and stock differ per store.
3. Add a few items. Use + and − on a tile. Open the cart (top right).
4. **Go to checkout** → you're asked to log in → **Create an account** → you come back to checkout.
5. Press **Place order** with nothing filled in: see the form errors.
6. Enter an address, pick a slot, place the order. You land on the order page.
7. Place a second order and **Cancel** it. Check **Orders** in the header.
8. Make the browser window narrow (or open it on your phone): the layout adapts.

## Task 5 — Be the store admin (10 min)

Make your account an admin (use the email you registered with):
```bash
bash scripts/make-admin.sh your-email@example.com
```
Then on the website: **Log out**, **Log in** again. An **Admin** link appears.

1. **Orders**: move your order along: Mark packed → Send out → Mark delivered.
2. **Stock and prices**: type `+24` next to a product, press Apply. Try `-9999`: refused.
   Tick "Only items with fewer than 5 left". Change a price. Untick "Shown" to hide a
   product, then check it's gone from the shop.
3. **Delivery slots**: open a new slot; see how full the next 24 hours are.
4. **Sales**: orders and revenue for the last 7 days, and best sellers.

## Task 6 — Run the website's tests (2 min)

In the **zsh** tab:
```bash
cd web
npm test
cd ..
```
Expect **8 passed** (the cart logic). The API tests still pass too: `cd api && npm test`
→ **60 passed**.

## Task 7 — Push

```bash
git add .
git commit -m "Day 5: React shop and admin dashboard"
git push
```
Then tell Claude **"Day 5 done"**. Day 6 is Docker for everything, load testing and Redis.

---

## Know how to explain (frontend interview questions)

**1. Component state vs server state.**
Server state lives in the database; the browser holds a copy that can go stale (products,
orders, who is logged in). It's handled by **TanStack Query**, which caches, refetches and
cancels outdated requests. Client state exists only in the browser (the cart, whether the
drawer is open, half-typed form values) and uses `useState` / `useReducer` / Context.
→ `web/src/pages/ShopPage.tsx` (server), `web/src/features/cart/` (client).

**2. Loading, error, empty, success.**
Every screen that fetches data handles all four. `components/Feedback.tsx` has the
spinner, the error box (with "Try again") and the empty state, so pages only write the
success case. Errors become one plain sentence in `api/client.ts` → `errorMessage`.

**3. Controlled forms.**
React state holds each input's value (`value` + `onChange`). That makes it easy to show
errors under fields, disable the button while sending, and show server errors
("An account with this email already exists"). Client checks give fast feedback;
the server still validates everything. → `pages/AuthPages.tsx`

**4. The cart is a reducer.**
`cartReducer(state, action) → newState`, a pure function, so it's tested without a browser
(`cartReducer.test.ts`). A cart belongs to one store. Prices in the cart are for display
only: the server re-prices at checkout.

**5. The idempotency key in the UI.** → `pages/CheckoutPage.tsx`
One key per *intended* order (`crypto.randomUUID()`). If the request fails with a network
error or 5xx, it is retried **with the same key**, so the server can't create two orders.
If the cart, slot or address changes, it's a different order and gets a new key.
Errors like "sold out" are never retried (asking again won't help); instead the page says
which item sold out and offers to remove it.

**6. Search state lives in the URL** (`?q=paneer&category=dairy`): the back button works,
refresh keeps the search, links can be shared. Typing is **debounced** (300 ms) so the API
isn't called on every key, and searches need 3+ letters (the trigram index from Day 2).

**7. Hiding admin pages is not security.**
`RequireAuth` only improves the experience. The API returns 401/403 on every admin route
no matter what the browser shows.

**8. One origin.** Vite forwards `/api` to the Express server (`web/vite.config.ts`), so the
browser talks to one address, the httpOnly cookie just works, and no CORS is needed.
