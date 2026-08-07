# What is left

A running list, kept so a long session can pick up without rediscovering everything. Newest
findings at the top of each section. When something here is done, delete it rather than ticking it.

## Security

**Done.** Signing in now issues a token signed by the server, held as both a header and an HttpOnly
cookie. On that:

- `PUT /api/collection/:key` no longer lets a stranger empty or rewrite anything. Money, prices,
  bank details and administrators are admin-only; removing records takes a session; a write that
  would delete most of a collection is refused outright. Registering, applying and ordering still
  work signed out, because those are additions.
- `GET /api/job/cv/file` and `GET /api/shop/proof/file` need a session.
- A forged token is rejected — the secret never leaves the server.

**Still to do:**

1. **No HTTPS.** Passwords are hashed in the browser, so the hash crosses the network in the clear
   and can be replayed, and the session cookie travels unprotected. Needs a domain name, then
   `certbot --nginx`. See DEPLOY.md. **This is now the biggest one.**
2. **Set `SESSION_SECRET`** in `/etc/masjidpoint.env`. Without it a random secret is generated at
   start, which is safe but signs everyone out whenever the service restarts.
3. **Ownership is not checked, only identity.** Any signed-in account may edit any record it can
   reach. Closing that means knowing which rows belong to whom, collection by collection.
4. **The admin default password is published** in this repository. Change it under Business profile
   → Administrators, or set `ADMIN_PASSWORD`.
5. **No backups.** `npm run backup` needs `BACKUP_ENCRYPTION_KEY` and nothing runs on a schedule.
   If that instance dies, the data and the uploaded files go with it.

## The big session, in the order I would take it

1. **A certificate, and SESSION_SECRET set.** The endpoints are closed; the wire is not. Needs a
   domain name pointed at the Elastic IP, then `certbot --nginx`.
2. **Masjid earnings.** The last sidebar entry with nothing behind it. The data exists.
3. **The remaining hardcoded demo data.** It has surfaced in nearly every file touched so far.
   Worth one deliberate sweep rather than finding it a screen at a time.

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
- **`masjidPointBusinessProfile` is one key for every business.** A second business signing in on
  the same browser reads the first one's saved profile. It is only a fallback now — the
  application's own details win — but the key should be per business.

## Tests

- **Each suite now gets its own server, port and freshly seeded database**, so the total is stable
  and a failure means the code rather than the order things ran in. `MASJIDPOINT_DATA_DIR` picks
  the store; the runner sets it. Setting `MASJIDPOINT_URL` still runs everything against one server
  you started yourself, with the old interference.
- **All twenty pass.** The four that were left were each stale rather than broken code:
  the two checkout suites predated the payment step; the two proof suites uploaded
  `assets/masjid-business-hero.png`, a file that does not exist, so every upload failed; the
  fixtures had to sign in once finances became administrator-only; and two assertions named an
  old notification key and the old `listing: 'ready'` state.
- **Each suite gets a port from the operating system**, so a development server or a second run
  cannot take one down with a failure that looks like the code.

## Deployment

- `sudo bash /opt/masjidpoint/scripts/ec2-setup.sh` pulls and restarts.
- **Close any open MasjidPoint tabs before testing a cleared database.** A tab still holding the old
  data in `localStorage` will sync it back onto the empty server — this has happened twice.
- To clear a browser that is doing it: `F12` → Console → `localStorage.clear(); sessionStorage.clear()`
  then reload.
- Emptying the collections leaves the uploaded files behind — evidence and CVs in
  `/opt/masjidpoint/data/uploads`. To remove those as well:

  ```bash
  sudo systemctl stop masjidpoint
  sudo rm -rf /opt/masjidpoint/data/uploads/*
  sudo systemctl start masjidpoint
  ```
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
