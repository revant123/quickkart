# Batch C: QuickKart online, on Render

About 20 minutes, mostly waiting for the first build. Everything runs on free plans.
You need: your Render account (linked to GitHub), your Resend account, and optionally your
Razorpay test keys. **Paste keys only into Render's pages, never into chat or code.**

## 1. Get the code (optional, for your laptop)

```bash
git pull
```
Render doesn't need this: it reads the code straight from GitHub.

## 2. Collect three values first

| Value | Where |
|---|---|
| **Resend API key** (`re_...`) | resend.com → **API Keys** → Create API key (permission: Sending access) |
| **Your Resend email** | the email address you signed up to Resend with |
| **Razorpay test keys** (optional) | dashboard.razorpay.com → Test Mode on → Account & Settings → API Keys |

Why your own email: until you own a domain, Resend only delivers to your address. So the
live demo sends **every** email and SMS to you, with the real recipient in the subject:
"[for asha@example.com] Order #12 placed".

## 3. Create everything from the Blueprint

1. https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect **revant123/quickkart** (if it isn't listed: *Configure account* → give Render
   access to that repo).
3. Render reads `render.yaml` and shows: **quickkart** (web service), **quickkart-redis**,
   **quickkart-db**. Blueprint name: `quickkart`.
4. It asks for the secret values:
   | Key | Put |
   |---|---|
   | `ADMIN_EMAILS` | the email you'll register on the live site with |
   | `RESEND_API_KEY` | your `re_...` key |
   | `MAIL_REDIRECT_TO` | your Resend email |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | your test keys, or leave empty (built-in test gateway) |
   | `RAZORPAY_WEBHOOK_SECRET` | leave empty for now (step 6) |
5. **Apply** (or **Deploy Blueprint**).

## 4. Watch the first deploy (5–10 minutes)

Click the **quickkart** service → **Logs**. You should see, in order:
```
migrated: 0001_baseline ... migrated: 0004_commerce
QuickKart API listening on http://localhost:10000
seed: empty database, loading sample data (takes a minute)...
seed: done in ...
```
The top of the page shows your address, like **https://quickkart-xxxx.onrender.com**. Open it.

If the build fails, copy the last ~30 lines of the log and send them to me.

## 5. Try it live

1. **Register** with the email you put in `ADMIN_EMAILS`: the **Admin** link appears.
2. Set your location (160017), order something, pay. Check your real inbox: "[for …] Order #1 placed"
   and "SMS to +91 …".
3. Make a rider: register a second account in a private window → Admin → Riders.
4. Open the site on your **phone** too: same address, works over mobile data.

Free plan note: after 15 minutes without visitors the site sleeps. The next visit shows
Render's loading page for about a minute. That's normal.

## 6. Razorpay webhook (only if you added Razorpay keys)

The webhook lets Razorpay tell QuickKart about a payment even if the customer closes the tab.

1. Make up a secret: run `openssl rand -hex 24` in your terminal and copy the result.
2. Razorpay dashboard (Test Mode) → **Account & Settings → Webhooks → Add New Webhook**:
   - URL: `https://<your-app>.onrender.com/api/payments/razorpay/webhook`
   - Secret: the string from step 1
   - Events: `payment.captured`, `payment.failed`, `order.paid`
   - Save.
3. Render → quickkart → **Environment** → `RAZORPAY_WEBHOOK_SECRET` = the same string → **Save**
   (it redeploys by itself).
4. Test: pay for an order, then close the tab before it finishes redirecting. Reload the
   order page: it's Paid anyway (the webhook did it). Razorpay → Webhooks → your webhook
   shows the deliveries and our `200` replies.

## 7. Put the link in your README

Edit the first lines of `README.md`, replace `LIVE-URL` with your address, commit, push.
Render redeploys automatically after every push to `main` (CI runs too).

## 8. Write in docs/notes.md (short answers)

- **Why one container instead of nginx + API?** One HTTPS address for site, API and live
  streams: no CORS, cookies just work, one free service.
- **How do secrets reach the app without being in Git?** `sync: false` in `render.yaml`:
  Render asks for them once and injects them as environment variables.
- **What happens on the first start?** Migrations, then the sample data loads because the
  database is empty. On later starts both see nothing to do.
- **Why Resend's API and not SMTP?** Render's free plan blocks SMTP ports. HTTPS (443) isn't blocked.
- **What did rehearsing the deploy catch?** The rate limiter loaded its Redis scripts before Redis
  had connected, and silently stopped limiting. Fixed by waiting for Redis.
- **Free-plan limits?** Sleeps after 15 minutes idle; the database expires after 30 days; one instance.

More: `docs/adr/0011-deploying-as-one-container-on-render.md`.
