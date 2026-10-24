# Batch A: live inventory, photos, migrations, rate limits, jobs, CI

Do these in order, in VS Code's terminal (zsh), from the `quickkart` folder.

## 1. Put the new files in place

```bash
cd ~/path/to/quickkart                 # your project folder
unzip -o ~/Downloads/quickkart-batch-a.zip -d .
git rm db/init/001_schema.sql db/init/002_indexes.sql db/init/003_search_index.sql
cd api && npm install && cd ..          # new packages: multer, express-rate-limit, rate-limit-redis
```

Why the `git rm`: the schema now lives in `api/migrations/` as numbered files. The API
applies new ones itself when it starts, so the old init scripts would only be a second,
out-of-date copy.

## 2. Upgrade your database and run it

```bash
docker compose up -d --build
docker compose logs api | grep -i migrat
```
You should see `migrated: 0001_baseline.sql`, `migrated: 0002_users_sessions_roles.sql`,
`migrated: 0003_product_images.sql`. Your existing data is kept: the baseline uses
`IF NOT EXISTS`, so it does nothing on tables you already have.

Run the API tests too:
```bash
docker compose --profile test up -d db-test
cd api && npm test && cd ..
```
Expect about 81 passed (5 Redis tests are skipped unless you set `TEST_REDIS_URL`).

## 3. Try live inventory (the fun part)

1. Open http://localhost:8080 in a normal window and log in.
2. Open it again in a **private/incognito** window and log in as a different user.
3. Both windows: search for something. The delivery band shows a green **Live** pill.
4. As admin (`bash scripts/make-admin.sh you@example.com`), go to Admin → Stock and set
   one product's stock to 2. Both shop windows show **"Only 2 left"** immediately.
5. Window A: add both to the cart. Window B: add one and check out.
   Window A's cart now says **"Only 1 left. Change to 1"** with no reload.
6. Place an order and keep its order page open. In Admin → Orders, mark it Packed.
   The order page changes to Packed by itself.

What's happening: the checkout transaction calls `pg_notify`. PostgreSQL delivers it only
when the transaction commits; each API container is `LISTEN`ing and forwards it to
browsers over Server-Sent Events. See `docs/adr/0006-live-updates-with-listen-notify-and-sse.md`.

## 4. Upload a photo

Admin → Stock → pick a product → **Upload**, choose a JPEG/PNG/WebP under 1 MB. The shop
shows it. **Remove** goes back to the illustration. Try renaming a `.txt` file to `.jpg`:
it's rejected (415), because the server checks the file's first bytes, not its name.

## 5. See the rate limiter

```bash
for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"x@y.com","password":"wrongpassword"}'; done; echo
```
The first 30 are `401`, then `429`: more than 30 login attempts per 15 minutes from one
address is blocked. Counters live in Redis, so it works across several API containers.
Wait 15 minutes, or `docker compose restart redis`, to reset it.

## 6. Push, then check CI

```bash
git add -A
git commit -m "Batch A: live inventory, product photos, migrations, rate limits, jobs, CI"
git push
```

If the push is **rejected** with a message about `workflow` scope: your GitHub token isn't
allowed to create workflow files. Fix it either way:
- **Easiest:** `git rm --cached .github/workflows/ci.yml`, `git commit --amend --no-edit`,
  `git push`. Then on github.com: your repo → **Add file → Create new file**, name it
  `.github/workflows/ci.yml`, paste the file's contents, **Commit**. Finally run `git pull`.
- Or create a new token with the `workflow` scope and push again.

Then open the repo's **Actions** tab. The "CI" run has three jobs (api, web, docker);
all three should go green in about 3–4 minutes. The badge at the top of the README turns
green too.

## 7. Write in docs/notes.md (short answers)

- **Why `LISTEN/NOTIFY` and not "poll every 5 seconds"?** Polling makes 1,000 open pages
  cost 200 requests a second even when nothing changes, and is still up to 5 s late.
  NOTIFY costs nothing until something changes and arrives in milliseconds.
- **Why send the notification inside the transaction?** If the order rolls back, nobody
  is told stock went down. PostgreSQL only delivers it on COMMIT.
- **Why SSE and not WebSockets?** Updates go one way (server → browser). SSE is plain HTTP,
  reconnects by itself, and passes through nginx with `proxy_buffering off`.
- **Why do sessions now hit the database?** So a removed admin or a "log out everywhere"
  takes effect on the next request. Cost: one primary-key lookup.
- **Why an advisory lock around migrations and jobs?** With 3 API containers, all 3 start
  at once; the lock makes exactly one do the work.
- **Why check image bytes, not the file name?** Names and `Content-Type` are chosen by the
  uploader; the first bytes of a real JPEG/PNG/WebP are fixed.
