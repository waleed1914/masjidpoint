# MasjidPoint

A platform connecting masjids, local businesses and community members. A business applies to
advertise through a specific masjid; the masjid approves it, sets its own rates, and keeps an
agreed share of everything paid through it. The same relationship carries job listings and a
community shop.

## Running it

```bash
npm install
npm start                 # http://127.0.0.1:4173
PORT=4174 node server.js   # the port the test suites expect
```

With no database configured it stores everything in `data/masjidpoint.json`. Set `DATABASE_URL`
for PostgreSQL — see `.env.example` and `PRODUCTION.md`.

```bash
npm run seed        # replace the data with the demo dataset (destructive)
npm run seed:print  # show the demo logins without writing anything
npm test            # backend checks, then browser journeys (needs a server on 4174)
npm run backup      # snapshot the current data
```

## Showing it to someone remotely

To put the site online from this machine — for a client to look at, not as hosting:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\preview.ps1   # prints an address and password
powershell -ExecutionPolicy Bypass -File scripts\preview-stop.ps1
```

It starts the server with `PREVIEW_PASSWORD` set and opens a Cloudflare tunnel. That password is
not decoration: `GET /api/state` returns every record including password hashes, and
`PUT /api/collection/:key` rewrites a whole collection without authenticating. Both are reasonable
on a machine only you can reach and neither is safe on the open internet, so the server refuses
every request — pages, assets and API alike — until the visitor has the password. Nothing else in
the app changes, and with `PREVIEW_PASSWORD` unset the gate does not exist, so local work and the
test suites are unaffected.

The PC must stay on and awake, the address changes each time, and the test suites will fail
against a gated server. This is for a look, not for real traffic — see `PRODUCTION.md` for that.

## Layout

```
server.js            HTTP server, API routes and static file resolution
lib/                 Node modules: storage, email, finance, invoicing, settlement
                     (shop-fulfilment.js and directory-data.js are shared with the browser)
public/              the pages
public/css/          stylesheets
public/js/           browser scripts
public/assets/       images and drawn artwork
scripts/             seeding, backup, restore, migration, the test runner
tests/               backend checks and end-to-end browser journeys
data/                the JSON store, generated email and uploaded evidence (not in git)
```

URLs stay flat regardless of where a file sits: `/styles.css`, `/masjid-shop.js` and
`/assets/logo-mark.svg` all resolve, because the server searches these directories in order.
Pages also resolve without their extension, so `/masjids` serves `public/masjids.html`.

## How the money works

Each masjid sets its own advertising price, job fee and split in the admin panel. The rate is
captured on the application when a business applies, so later changes never re-price work already
in flight. Payment state is **derived from the finance ledger** rather than stored directly: an
advert or job counts as paid when a settled invoice line references it, which is why fixtures
cannot simply mark something paid — the invoice has to exist and be settled.

Shop products carry their own `mosqueSharePercent`, set per product, separate from the
advertising split.

## Testing notes

`npm test` starts each suite against a running server. Several suites sign in as accounts defined
in `scripts/seed-demo-data.js`; if that dataset is not loaded, those suites report **SKIP** rather
than failing, so a real regression is never buried in fixture noise.

Browser journeys drive Microsoft Edge over the DevTools protocol and leave profile directories
under `tests/` — these are ignored by git and safe to delete.
