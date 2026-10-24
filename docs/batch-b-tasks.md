# Batch B: payments, nearest store, addresses, accounts, notifications, riders

Do these in order, in VS Code's terminal (zsh), from the `quickkart` folder.

## 1. Get the code

```bash
git pull
cd api && npm install && cd ..        # new package: nodemailer (sends email)
```

## 2. Put your Razorpay TEST keys in `.env` (optional, 2 minutes)

Without keys, QuickKart uses its own **built-in test gateway**: same flow, a simple "Test
payment" window, no account needed. With keys, Razorpay's real payment window opens.

1. https://dashboard.razorpay.com → make sure the **Test Mode** switch (top) is on.
2. **Account & Settings → API Keys → Generate Test Key**. Copy the Key ID (`rzp_test_...`)
   and the Key Secret (shown only once).
3. Open the **`.env` file in the project root** (not `.env.example`) and add:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
   ```
4. Check it can't be committed: `git status` must **not** list `.env`. (It's in `.gitignore`.)

Never paste the secret into chat, code, or `.env.example`.

## 3. Start everything

```bash
docker compose up -d --build
docker compose logs api | grep -i migrat      # expect: migrated: 0004_commerce
```

Two tabs to keep open:
- the shop: **http://localhost:8080**
- the test inbox: **http://localhost:8025** (every email and SMS lands here; nothing is really sent)

## 4. Try it as a customer

1. **Register** a new account. The shop says "Confirm your email". In the inbox, open
   "Confirm your email for QuickKart" and click the button.
   *Your older accounts aren't confirmed yet:* log in, go to **Account → Send the link again**.
2. **Location:** click "Set your location" (top left), type **160012**, then **Find stores**.
   QuickKart North is nearest. Try **140603** (Zirakpur): no store delivers that far.
3. **Pay online:** add a few items → Checkout → add an address (pincode 160012; the city
   fills itself) → pick a slot → **Pay**.
   - Built-in gateway: click **Pay**.
   - Razorpay: choose **UPI** and enter `success@razorpay` (test mode, no real money).
   The order page says "Paid". In the inbox: "Order #… placed" and an **SMS to +91 …**.
4. **Pay later:** place another online order but **close** the payment window. The order page
   shows a 15-minute countdown and a **Pay now** button. Your items are held meanwhile.
   (If you wait 15 minutes, it's cancelled and the stock goes back.)
5. **Cash on delivery:** one more order, choose **Cash on delivery**.
6. **Refund:** open the paid order from step 3 and **Cancel order**. Within ~20 seconds the
   page says it was refunded, and the inbox has "Refund of ₹…".

## 5. Try it as a rider (two browser windows)

1. In a **private/incognito window**, register a second account (the rider).
2. In your admin window: **Admin → Riders**, enter the rider's email, pick the store your
   cash order came from (QuickKart North), **Make rider**.
3. Rider window: refresh. A **Deliveries** link appears. Open it.
4. Admin window: **Orders** → **Mark packed** on the cash order. It appears on the rider's
   page by itself (live).
5. Rider: **Pick up**. The customer's order page now says "<name> is on the way", and the
   inbox has the SMS. Rider: **Cash collected, delivered**. The order is Delivered and "Paid in cash".

Try the race yourself: open the Deliveries page as two riders and tap Pick up on the same
order together. One gets it, the other sees "Another rider picked this order up first."

## 6. Forgot password

Log out → Log in → **Forgot password?** → your email → open "Reset your QuickKart password"
in the inbox → choose a new password. Every other logged-in window of that account is now
logged out (that's on purpose: if someone stole your session, the reset kicks them out).

## 7. Run the tests

```bash
docker compose --profile test up -d db-test
cd api && npm test && cd ..       # 132 passed (5 more with TEST_REDIS_URL)
```

New test files: `payments.test.ts`, `rider.test.ts`, `outbox.test.ts`, `accounts.test.ts`,
`location.test.ts`. Read one test from each and connect it to the ADRs below.

## 8. Write in docs/notes.md (short answers)

- **Why is the order created *before* the payment?** To hold the stock while the customer
  pays. Otherwise two people could both pay for the last item.
- **Why not call Razorpay inside the checkout transaction?** The transaction holds the stock
  row lock. A 2-second network call would make every other buyer of that item wait 2 seconds.
- **Why check a signature instead of trusting "payment succeeded" from the browser?**
  Anyone can send that request with any data. Only Razorpay (and our server) know the secret
  that makes `HMAC(order_id|payment_id)` come out right.
- **Why a webhook as well?** The customer might pay and close the tab before the browser
  reports back. Razorpay's server tells ours directly.
- **What if the browser and the webhook arrive together?** Both lock the payment row; the
  second sees "already paid" and does nothing. One order, one email (tested).
- **What's a transactional outbox?** The email is saved in a table in the same transaction
  as the order, then a job sends it. No email for orders that rolled back; no lost email if
  the mail server is down.
- **How do 5 riders not get the same order?** `UPDATE ... WHERE status = 'PACKED' AND
  rider_id IS NULL`: the first locks the row, the rest re-check and match nothing.
- **Why store only a hash of the reset token?** If the database leaks, the attacker still
  can't use the links.

Design decisions with trade-offs: `docs/adr/0008`, `0009`, `0010`.

## 9. Push

Nothing to push: these changes are already on GitHub (`git pull` brought them). If you
edited `docs/notes.md`, commit and push that as usual.

Razorpay **webhooks** need a public HTTPS address, so they get switched on in Batch C
(deploying to Render).
