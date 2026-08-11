# MasjidPoint production data

## Database

Production uses PostgreSQL when `DATABASE_URL` is set. `NODE_ENV=production` deliberately refuses to start without it, so the JSON development file cannot accidentally become the live database.

1. Copy `.env.example` to `.env` and supply secrets through the hosting provider (never commit `.env`).
2. Create an empty PostgreSQL database with encrypted connections and point-in-time recovery enabled.
3. Run `npm run migrate:postgres` once to copy the current prototype state.
4. Start with `NODE_ENV=production npm start`.

Production also refuses to start without a strong `ADMIN_PASSWORD` and a permanent random
`SESSION_SECRET` of at least 48 characters. Passwords are hashed server-side with bcrypt. Accounts
created by an older prototype are upgraded from legacy SHA-256 to bcrypt at their next successful
password sign-in; plaintext passwords are never persisted.

## Authentication controls

- Sessions expire after 30 minutes and use `Secure`, `HttpOnly`, `SameSite=Strict` cookies.
- Same-origin validation protects every POST, PUT, PATCH and DELETE request from CSRF.
- Credential, OTP, reset and upload endpoints have application-level rate limits. Add AWS WAF
  rate-based rules as a second layer.
- The Platform Owner can enable or disable email-based two-factor authentication for each
  administrator under **Admin profiles**.
- There is no published default administrator password. A local empty database prints a random
  one-time bootstrap password; production must supply `ADMIN_PASSWORD` before startup.

The repository creates `app_state` and private `documents` metadata tables. Updates are versioned with an update timestamp. The current JSON-shaped state is preserved to avoid breaking the frontend; it can be normalised into domain tables after the workflows stabilise.

## Private uploads

Use a private S3-compatible bucket. Public bucket access must remain disabled. Configure the `OBJECT_STORAGE_*` variables in `.env.example` and enable bucket versioning, default encryption, and a lifecycle rule for superseded evidence.

The storage layer enforces:

- payment proofs: JPEG, PNG or PDF; maximum 5 MB;
- CVs: PDF or DOCX; maximum 5 MB;
- other documents: JPEG, PNG, PDF or DOCX; maximum 10 MB;
- random UUID object names, SHA-256 checksums and server-side encryption;
- private objects with short-lived (120 second) read links.

Do not expose storage credentials or permanent object URLs in browser code. Portal upload/download
endpoints require the server-issued HttpOnly session and verify document ownership. Payment proofs,
settlement evidence and CVs use this private storage layer; product and mosque profile images remain
public catalogue assets and should be moved to a dedicated public image bucket/CDN at launch scale.

## Backup and recovery

`npm run backup` creates an AES-256-GCM encrypted state backup under `backups/`. Set a long random `BACKUP_ENCRYPTION_KEY` in the secret manager. Copy the generated file to a different account/region from the live database.

Restore into a staging database first:

```text
npm run restore -- backups/state-YYYY-MM-DD....mpbackup
```

Recommended schedule:

- PostgreSQL point-in-time recovery: continuous, at least 14 days;
- encrypted application export: daily, retained for 30 days;
- monthly archive: retained for 12 months;
- object storage versioning: enabled;
- recovery drill: quarterly, with restored record and attachment checks.

Backups are incomplete unless both PostgreSQL and the private object bucket are recoverable.

## Transactional email

Configure `APP_BASE_URL`, `EMAIL_FROM` and the `SMTP_*` variables. Production refuses to start without `SMTP_HOST`. Set `SMTP_VERIFY=true` so deployment verifies the connection before accepting traffic.

Email events include application approval/rejection, 48-hour account activation links, payment-proof approval/rejection, mosque settlement notices and 30-minute single-use password-reset links. Development emails are written to the ignored `data/email-outbox/` directory instead of being delivered.

Use a verified sending domain with SPF, DKIM and DMARC. SMTP credentials belong in the deployment secret manager, not `.env` in source control.
