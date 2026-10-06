# MDrag Orders API

A small backend that gives your website a real database for orders.
When a customer confirms an order on `checkout.html`, it's sent here
and saved in a SQLite database file (`orders.db`). You can then view
every order from `orders.html` on your site, from any device — not
just the browser that placed the order.

This is a normal Node.js server. It needs to run somewhere with a
public URL (see **Deploying** below) — it can't run "inside" a static
website by itself.

## What's included

- `server.js` — the API (Express + SQLite via `better-sqlite3`)
- `package.json` — dependencies
- `.env.example` — settings you need to configure
- `orders.db` — created automatically the first time the server runs

## Endpoints

| Method | Path                     | Auth        | Purpose                          |
|--------|--------------------------|-------------|-----------------------------------|
| GET    | `/`                      | none        | Health check                      |
| POST   | `/api/orders`            | none        | Create an order (used by checkout)|
| GET    | `/api/orders`            | admin key   | List all orders                   |
| GET    | `/api/orders/:id`        | admin key   | Get one order                     |
| PATCH  | `/api/orders/:id/status` | admin key   | Update order status               |
| POST   | `/api/consults`            | none        | Create a consult request (used by consult.html) |
| GET    | `/api/consults`            | admin key   | List all consult requests         |
| GET    | `/api/consults/:id`        | admin key   | Get one consult request           |
| PATCH  | `/api/consults/:id/status` | admin key   | Update consult request status     |

"Admin key" means the request must include a header:
`x-admin-key: <your ADMIN_KEY value>`. This is what keeps your orders
private — anyone without the key can only *create* orders, not *read*
them.

## 1. Run it locally (to test)

```bash
cd server
cp .env.example .env
# open .env and set ADMIN_KEY to a long random string
npm install
npm start
```

You should see:
```
MDrag Orders API listening on port 4000
```

Test it's alive:
```bash
curl http://localhost:4000/
```

Test creating an order:
```bash
curl -X POST http://localhost:4000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test User","phone":"12345678","email":"test@example.com","address":"1 Example St","city":"Tunis","items":[{"name":"GROHE — Concealed Flush Button","price":150,"qty":1}],"total":150}'
```

Test reading orders back (replace the key with yours):
```bash
curl http://localhost:4000/api/orders -H "x-admin-key: your-secret-here"
```

## 2. Deploying it so your live website can reach it

Pick any Node.js host. Two easy, free-tier-friendly options:

### Option A — Render.com
1. Push this `server/` folder to a GitHub repo (or a repo containing it).
2. On [render.com](https://render.com), click **New → Web Service**, connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under **Environment**, add `ADMIN_KEY` (your secret) and `ALLOWED_ORIGINS`
   (the URL where your site is hosted, e.g. `https://yourstore.com`).
5. Deploy. Render gives you a URL like `https://mdrag-orders-api.onrender.com`.

### Option B — Railway.app
1. Push the `server/` folder to GitHub.
2. On [railway.app](https://railway.app), **New Project → Deploy from GitHub repo**.
3. Add the same environment variables as above under **Variables**.
4. Railway gives you a public URL automatically.

Any other Node host (Fly.io, a VPS, etc.) works the same way — install
dependencies, set the two environment variables, run `npm start`.

**Important:** `better-sqlite3` stores data in a single file
(`orders.db`) on disk. Free tiers on most hosts (including Render)
give you an *ephemeral* filesystem — that file gets wiped every time
the service redeploys, restarts, or spins down from inactivity. Fine
for testing, risky for real orders. To make it persistent:
1. Upgrade the backend to a paid instance (Render's Starter plan is $7/mo).
2. Attach a persistent disk (Render charges $0.25/GB/month — a few
   cents for order data), mounted at, say, `/var/data`.
3. Set the `DB_PATH` environment variable to `/var/data/orders.db`.

Without a persistent disk, everything still works — orders just don't
survive a redeploy or a free-tier spin-down.

## 3. Point your website at the deployed API

Open `config.js` in your site (it sits next to `index.html`):

```js
window.MDRAG_CONFIG = {
  apiBase: ''
};
```

Set `apiBase` to your backend's URL, e.g.:

```js
window.MDRAG_CONFIG = {
  apiBase: 'https://mdrag-orders-api.onrender.com'
};
```

Also go back to your backend's environment variables on Render and set
`ALLOWED_ORIGINS` to your site's real URL (e.g. `https://mdrag-site.vercel.app`)
— without this, the browser will block checkout from reaching the API.

That's it — `checkout.html` will now save confirmed orders to this
server, and `orders.html` will read them back for you (it will ask
for your admin key the first time you open it).
