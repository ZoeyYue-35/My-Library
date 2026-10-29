# Hosted deployment

The container now supports persistent managed PostgreSQL, private S3-compatible
object storage, database-backed sessions, account-level draft recovery, and a
host-injected encryption key. It still needs real cloud resources and a hosting
account before a public URL exists. Never deploy with the local JSON fallback.

`render.yaml` defines a paid Render web service and managed PostgreSQL database.
It intentionally leaves R2 and encryption credentials as dashboard-provided
secrets. Review Render's current plan prices before applying the Blueprint.

## Render + Cloudflare R2

1. Push the repository to GitHub, then in Render choose **New → Blueprint** and
   select this repository. Render reads `render.yaml` and creates the web
   service plus managed PostgreSQL. Applying the Blueprint may incur charges.
2. In Cloudflare, create a private R2 bucket with public access disabled. Create
   an R2 token scoped to only this bucket with object read/write/delete access.
3. In Render's prompted secret values, enter the R2 S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`), bucket name, R2 access key
   ID, R2 secret access key, and a Fernet key generated as described below.
   Enter secrets directly in Render, never in chat or repository files.
4. The Blueprint selects `AWS_REGION=auto` and
   `S3_SERVER_SIDE_ENCRYPTION=NONE`. R2 encrypts data at rest by default; the
   `NONE` setting only omits AWS-specific SSE headers that R2 does not need.
5. Wait for the Render health check, then verify `/api/health` reports
   `mode: cloud`. Test registration, browser restart, uploads, downloads,
   account deletion, and restore before sharing the URL.

Do not invite users until backups, recovery tests, provider-side rate limits,
privacy contact details, and retention/deletion policy are in place.

## Required service configuration

Set these variables in the hosting platform's secret/configuration panel, not in
Git or a committed `.env` file:

| Variable | Required value |
| --- | --- |
| `MY_LIBRARY_ENV` | `production` |
| `PORT` | Platform-provided port |
| `DATABASE_URL` | Managed PostgreSQL connection URI with TLS |
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
bucket. Keep bucket versioning and provider-side backups enabled. The app never
creates public or presigned file URLs; downloads go through an authenticated API
route that verifies the owning account first.

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

1. Create a managed PostgreSQL database and a private, encrypted object bucket.
2. Configure TLS, provider-side automated backups, point-in-time recovery where
   available, public-access blocking, and a restricted bucket identity.
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
