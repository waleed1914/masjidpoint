# What is left

A running list, kept so a long session can pick up without rediscovering everything. Newest
findings at the top of each section. When something here is done, delete it rather than ticking it.

## Security — do these before the platform holds anything real

The whole site is open: there is no password in front of it, and these are the holes behind that.

1. **`PUT /api/collection/:key` is unauthenticated.** Anyone who knows the address can replace any
   collection — wipe every job, forge orders, rewrite invoices. This is how the live database was
   cleared for testing, which shows exactly what it allows. Needs a session check on writes, which
   touches how every page saves.
2. **`GET /api/job/cv/file` checks only the reference.** Anyone holding an application reference can
   read that CV — somebody's employment history, address and phone number. Worse than the listing
   data around it. Needs an employer session.
3. **`GET /api/shop/proof/file` is the same** for payment evidence, which may show bank details.
4. **No HTTPS.** Passwords are hashed in the browser, so the hash crosses the network in the clear
   and can be replayed. Needs a domain name, then `certbot --nginx`. See DEPLOY.md.
5. **The admin default password is published** in this repository. Change it under Business profile
   → Administrators, or set `ADMIN_PASSWORD` in `/etc/masjidpoint.env`.

## Design work, asked for and not started

- **Masjid shop collection page** — asked for "a very good UI". Not begun; it is design work rather
  than a bug fix and deserves its own pass.
- **Admin shop page** (`/admin-masjid-products`) — same request. The evidence link and the broken
  thumbnails on it are fixed; the layout is not.

## Features the sidebar used to promise and nothing renders

- **Masjid earnings.** Removed from the sidebar rather than left as a dead link. The data exists —
  settlements, mosque share per invoice — so it is buildable.

## Written but not verified

- **The masjid notification as an order moves toward it** (`ready_for_mosque`, `mosque_received`,
  `dispatched`) is written and parses, but I could not stage that transition in a test: the
  fulfilment button stays disabled because the reconciler re-derives the payment state from the
  finance records, so setting `paymentStatus` on the order directly does not stick. Check it by
  hand — verify a bank payment, then press "Ready for mosque collection" and look at the masjid's
  notifications. If nothing arrives, the map of statuses is in `admin-masjid-products.js` beside
  the `[data-order-next]` handler.

## Known bugs, not yet fixed

- **Masjid detail page: shop payment evidence.** The admin path is fixed and verified. The masjid's
  own view of shop evidence was reported broken as well and has not been checked.
- **The advertise form requires a website.** A business without one cannot apply at all.
- **`masjidPointBusinessProfile` is one key for every business.** A second business signing in on
  the same browser reads the first one's saved profile. It is only a fallback now — the
  application's own details win — but the key should be per business.

## Tests

- **Five suites fail, and have since before this stretch of work**: `frontend-business-flow`
  (blocked by the required website above), `frontend-business-isolation`, `frontend-customer` and
  `frontend-shop-fulfilment` (both describe the checkout flow from before the payment step was
  added), `frontend-payment-proof`, `frontend-advertising-pricing`.
- **The suites share one database and mutate each other's data**, so the total moves between runs
  for reasons that have nothing to do with the code. Anything measured from a combined run is
  unreliable; re-seed and run a suite alone before believing it. Worth giving each suite its own
  database.

## Deployment

- `sudo sed -i '/^PREVIEW_/d' /etc/masjidpoint.env` then
  `sudo bash /opt/masjidpoint/scripts/ec2-setup.sh` — the first line only matters once, to remove
  the password prompt an earlier deployment left in the environment file.
- **Close any open MasjidPoint tabs before testing a cleared database.** A tab still holding the old
  data in `localStorage` will sync it back onto the empty server.
- `PRODUCTION.md` still applies: `NODE_ENV=production` refuses to start without PostgreSQL and
  SMTP, so the deployment runs in JSON mode.

## Things worth knowing when reading this code

- **Hardcoded demo values keep turning up** and are always the same shapes: `'Amanah Accounting'`,
  `'BUS-00184'`, `'Central Masjid'`, `'INV-2026-00841'`. Several have been removed; assume more
  remain, and grep for them before trusting anything that looks like a default.
- **Two things render most portal pages.** `masjid-portal.js` and `business-portal.js` draw them,
  then `portal-context.js` and `business-isolation.js` re-render several with different data
  attributes. A handler bound by the first is lost when the second replaces the markup — that is
  why the job review button never appeared, and why payment evidence went to the wrong place.
- **`payment-proof-context.js` clones the proof form**, which discards every listener attached to
  it. Anything bound to that form elsewhere is dead.
- **`local-db.js` route-injects page scripts by exact path**, so a new address has to be added to
  its `PORTAL_SECTIONS` / `BUSINESS_SECTIONS` patterns or the scripts that build that page never
  load.
- **`styles.css` sets `scroll-behavior: smooth`**, so anything measuring an element's position
  after `scrollIntoView` must wait for the scroll to finish.
