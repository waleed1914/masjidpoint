# MasjidPoint production data

## Database

Production uses PostgreSQL when `DATABASE_URL` is set. `NODE_ENV=production` deliberately refuses to start without it, so the JSON development file cannot accidentally become the live database.

1. Copy `.env.example` to `.env` and supply secrets through the hosting provider (never commit `.env`).
2. Create an empty PostgreSQL database with encrypted connections and point-in-time recovery enabled.
3. Run `npm run migrate:postgres` once to copy the current prototype state.
4. Start with `NODE_ENV=production npm start`.

The repository creates `app_state` and private `documents` metadata tables. Updates are versioned with an update timestamp. The current JSON-shaped state is preserved to avoid breaking the frontend; it can be normalised into domain tables after the workflows stabilise.

## Private uploads

Use a private S3-compatible bucket. Public bucket access must remain disabled. Configure the `OBJECT_STORAGE_*` variables in `.env.example` and enable bucket versioning, default encryption, and a lifecycle rule for superseded evidence.

The storage layer enforces:

- payment proofs: JPEG, PNG or PDF; maximum 5 MB;
- CVs: PDF or DOCX; maximum 5 MB;
- other documents: JPEG, PNG, PDF or DOCX; maximum 10 MB;
- random UUID object names, SHA-256 checksums and server-side encryption;
- private objects with short-lived (120 second) read links.

Do not expose storage credentials or permanent object URLs in browser code. Portal upload/download endpoints must require the server-issued HttpOnly user session and verify document ownership. This is intentionally the next dependency before replacing the remaining IndexedDB calls.

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
