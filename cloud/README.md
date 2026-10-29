# Hosted deployment

The container now supports persistent managed PostgreSQL, private S3-compatible
object storage, database-backed sessions, account-level draft recovery, and a
host-injected encryption key. It still needs real cloud resources and a hosting
account before a public URL exists. Never deploy with the local JSON fallback.

`render.yaml` defines a free Render web service and expects an external
PostgreSQL connection string. The recommended database is Supabase Pro, which
has recurring fees but includes daily database backups. R2 and encryption
credentials are entered as dashboard secrets. The app container may sleep; its
user data is held in PostgreSQL and R2, not on the container filesystem.

## Render + Supabase + Cloudflare R2

1. Push the repository to GitHub, then in Render choose **New → Blueprint** and
   select this repository. Render reads `render.yaml` and creates only the free
   web service. It does not create a Render database.
2. Create a Supabase project on the Pro plan. Copy its TLS-enabled PostgreSQL
   connection string from the dashboard into Render's `DATABASE_URL` prompt.
   Prefer the session pooler connection if the direct endpoint is not reachable
   from the Render region.
3. In Cloudflare, create a private R2 bucket with public access disabled. Create
   an R2 token scoped to only this bucket with object read/write/delete access.
4. In Render's prompted secret values, enter the Supabase connection string,
   R2 S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`), bucket name,
   R2 access key ID, R2 secret access key, and a Fernet key generated below.
   Enter secrets directly in Render, never in chat or repository files.
5. The Blueprint selects `AWS_REGION=auto` and
   `S3_SERVER_SIDE_ENCRYPTION=NONE`. R2 encrypts data at rest by default; the
   `NONE` setting only omits AWS-specific SSE headers that R2 does not need.
6. Wait for the Render health check, then verify `/api/health` reports
   `mode: cloud`. Test registration, browser restart, uploads, downloads,
   account deletion, and restore before sharing the URL.

Supabase Pro's daily database backups have a seven-day retention window. They
do not include R2 object bytes, so R2 resumes remain durable across application
sleep/redeploy but need a separate backup policy if recovery from accidental
object deletion is required. Daily database backups may lose up to a day's
changes; enable Supabase PITR if that recovery window is unacceptable.

Do not invite users until backups, recovery tests, provider-side rate limits,
privacy contact details, and retention/deletion policy are in place.

## Estimated recurring cost

| Service | Expected cost | Notes |
| --- | --- | --- |
| Render web service | $0/month | Free instances sleep after 15 minutes idle; first request may wait about a minute. |
| Supabase Pro database | About $25/month | Recurring subscription; includes $10/month compute credits and daily database backups retained for 7 days. |
| Cloudflare R2 | $0 within quota | 10 GB-month storage, 1 million Class A operations, 10 million Class B operations, and free egress; overages are usage-billed. |
| Render-provided HTTPS domain | $0 | A custom domain is optional and costs extra through its registrar. |

There is no one-time setup charge in this estimate. Supabase Pro is a recurring
monthly bill. It is not a zero-loss guarantee: daily snapshots can lose up to a
day of database writes, and they do not contain R2 file bytes. Supabase PITR
starts at about $100/month and also requires a Small compute add-on; with Pro
and the current compute credits, budget roughly $130/month total. Confirm the
live plan and region prices before provisioning. OpenAI usage is billed to each
user's own provider account, not included here.

R2 keeps uploaded files outside the sleeping Render container, so app sleep,
restart, or redeploy does not remove them. Database backups do not restore
objects accidentally deleted from R2; configure and test a separate object
backup before relying on recovery from deletion or corruption.

## Required service configuration

Set these variables in the hosting platform's secret/configuration panel, not in
Git or a committed `.env` file:

| Variable | Required value |
| --- | --- |
| `MY_LIBRARY_ENV` | `production` |
| `PORT` | Platform-provided port |
| `DATABASE_URL` | Supabase Pro PostgreSQL connection URI with TLS |
| `DATABASE_SSLMODE` | `require` (default) or provider-required stronger mode |
| `S3_BUCKET` | Private bucket name |
| `AWS_REGION` | Bucket region |
| `S3_ENDPOINT_URL` | Optional endpoint for S3-compatible providers such as R2 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Only if the platform cannot use a scoped workload identity |
| `MY_LIBRARY_ENCRYPTION_KEY` | Stable Fernet key from the platform secret manager |

Generate a Fernet key locally and paste it directly into the secret manager; do
not send or commit its output:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

The app applies SQL files in `migrations/` under a PostgreSQL advisory lock at
startup. The database user needs permission to create tables and indexes. Back
up the database before applying future migrations.

## Object storage

The bucket must have public access blocked, TLS enforced, and a narrowly scoped
service identity that can only list/read/write/delete objects in this app's
bucket. Configure and test a separate backup before relying on recovery from
accidental object deletion. The app never creates public or presigned file URLs;
downloads go through an authenticated API route that verifies the owning account
first.

Uploads use server-side encryption (`S3_SERVER_SIDE_ENCRYPTION=AES256` by
default). For provider-managed KMS encryption, set
`S3_SERVER_SIDE_ENCRYPTION=aws:kms` and `S3_KMS_KEY_ID`. The app stores object
keys and metadata in PostgreSQL, not file bytes. Set lifecycle/retention rules
only after aligning them with the deletion and recovery policy.

## Sessions and user-provided API keys

Hosted sign-in uses a 30-day `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only a
SHA-256 hash of its random token is stored in PostgreSQL. Account content,
interview drafts, target job descriptions, and session records therefore
survive browser restarts and application restarts. Clearing browser cookies or
signing out ends the session; saved account data remains in the database.

When a user connects an OpenAI API key, the browser sends it only to the
authenticated same-origin backend over HTTPS. The backend verifies it, encrypts
it with `MY_LIBRARY_ENCRYPTION_KEY`, and stores ciphertext with the account
record. The browser receives only a last-four-character hint. Decryption is
limited to the requested AI operation. The encryption key must remain stable;
rotating it requires a planned re-encryption migration before changing the
secret. Managed database encryption at rest is still required as defense in
depth.

## Release checklist

1. Create a Supabase Pro project and a private R2 bucket.
2. Confirm Supabase daily backups are enabled and test a restore. Enable PITR if
   the seven-day backup window or up-to-one-day recovery point is insufficient.
   R2 object bytes need their own backup/restore procedure.
3. Configure the variables above in the hosting platform; set a Fernet key in
   its secret manager. Never copy `storage/` into the image or upload it to Git.
4. Build `cloud/Dockerfile`, deploy behind the provider's HTTPS endpoint, and
   verify `/api/health` reports `mode: cloud`.
5. In staging, test account creation, sign-in after browser restart, two-account
   data isolation, file upload/download/delete, AI key replacement/removal, and
   recovery after restarting/redeploying the app.
6. Configure edge and per-account rate limits for authentication and AI routes,
   request timeouts/body limits, private redacted logs, alerts, and tested
   restore procedures. The application rejects JSON bodies above its configured
   limit; provider edge limits should be lower and route-aware.
7. Publish a privacy notice, data retention and account-deletion process, and
   support contact. Review applicable privacy laws before accepting public
   users.
8. Only after these checks, attach the public domain and share its HTTPS URL.

This repository cannot create cloud resources or publish a public URL without
access to the chosen provider account, DNS, and deployment secrets. Local data
is not automatically uploaded during deploy; plan and verify any import
separately before inviting existing users.
