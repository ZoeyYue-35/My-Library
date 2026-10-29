# Hosted deployment

The container now supports persistent managed PostgreSQL, private S3-compatible
object storage, database-backed sessions, account-level draft recovery, and a
host-injected encryption key. It still needs real cloud resources and a hosting
account before a public URL exists. Never deploy with the local JSON fallback.

`render.yaml` defines a free Render web service and expects an external
PostgreSQL connection string. The low-cost setup uses Supabase Free for the
database and primary private file bucket, plus an independent Cloudflare R2
bucket for encrypted backups. Render may sleep; user data remains in Supabase.

## Render + Supabase Free + R2 Backups

1. Create a Supabase Free project. Create one private Storage bucket for My
   Library uploads. From Supabase Settings, collect the database connection
   string and S3 endpoint, region, access key, and secret access key.
2. Push the repository to GitHub, then in Render choose **New → Blueprint** and
   select this repository. Render reads `render.yaml` and creates only the free
   web service.
3. Enter the Supabase connection string, S3 endpoint, bucket name, S3 region,
   access key, secret key, and `MY_LIBRARY_ENCRYPTION_KEY` in Render's prompted
   secrets. Use the Supabase project region, not `auto`. Never put secrets in
   chat or repository files.
4. Create a separate private Cloudflare R2 bucket for backups. Create a
   bucket-scoped R2 token that can list, upload, read, and delete backup
   objects. In GitHub repository **Settings → Secrets and variables → Actions**,
   add the backup secrets listed below and the public `AGE_RECIPIENT` variable.
5. Generate the age keypair on a trusted machine. Keep `age-identity.txt`
   offline in a password manager or encrypted offline storage, and add only its
   public `age1...` recipient as a GitHub Actions repository variable. The
   workflow encrypts every backup before upload.
6. Run **Actions → Encrypted cloud backup → Run workflow** once. Confirm it
   succeeds and creates an encrypted object in R2; then let the daily schedule
   run. Check failed workflow notifications and test a restore before inviting
   users.

Supabase Free currently includes 5 GB monthly egress. A full daily export
transfers the database and all files each time; monitor its size and project
egress. If backup or app traffic exceeds the free allowance, this is no longer
a $0/month setup. Supabase Free can pause a low-activity project after about a
week; its data is not on Render's ephemeral filesystem. Its S3-compatible
Storage API does not support object versioning, which is why the independent R2
backup is included.
The backup workflow exports the two My Library-owned database tables and all
uploaded object bytes, encrypts the archive with age, verifies the R2 upload,
then keeps the latest six snapshots. Users need to sign in again after a
database restore because active sessions are intentionally excluded.

Each run estimates the database and object total before downloading. By default,
it stops before data transfer when that estimate exceeds 100 MiB; the workflow
does not upload or prune anything in that case, and the previous good backups
remain available. This keeps the scheduled backup transfer to at most about
3 GiB/month before app traffic, within Supabase Free's 5 GB egress allowance
with limited headroom. It also caps six uncompressed source snapshots at about
600 MiB before compression. If a backup is skipped, new changes are not
protected; review the data size and provider quota before raising
`MAX_DAILY_SOURCE_BYTES`. Frequent manual runs use additional egress.

This is a low-cost recovery path, not zero-loss/high-availability service. A
daily schedule can lose up to one day of changes. GitHub Actions, Supabase, and
R2 usage remain subject to their free-plan quotas and terms.

## Estimated recurring cost

| Service | Expected cost | Notes |
| --- | --- | --- |
| Render web service | $0/month | Free instances sleep after 15 minutes idle; first request may wait about a minute. |
| Supabase Free | $0/month | 500 MB database and 1 GB file storage; may pause after about a week of low activity. |
| GitHub Actions | $0 within plan quota | One daily job backs up database tables and uploaded files; monitor failures. |
| Cloudflare R2 | $0 within quota | 10 GB-month for encrypted snapshots, 1 million Class A operations, 10 million Class B operations, and free egress. |
| Render-provided HTTPS domain | $0 | A custom domain is optional and costs extra through its registrar. |

No fixed monthly fee or one-time cloud charge is expected while all services
remain within free quotas. The 100 MiB safety cap keeps six uncompressed source
snapshots near 600 MiB, below R2's 10 GB-month free allowance. Exceeding the
Supabase 500 MB database, 1 GB file-storage, 5 GB egress, or R2 quotas can incur
charges; set provider budget alerts and review current terms. OpenAI usage is
billed to each user's own provider account and is not included.

## Required service configuration

Set these variables in the hosting platform's secret/configuration panel, not in
Git or a committed `.env` file:

| Variable | Required value |
| --- | --- |
| `MY_LIBRARY_ENV` | `production` |
| `PORT` | Platform-provided port |
| `DATABASE_URL` | Supabase Free PostgreSQL connection URI with TLS |
| `DATABASE_SSLMODE` | `require` (default) or provider-required stronger mode |
| `S3_BUCKET` | Supabase private Storage bucket name |
| `AWS_REGION` | Supabase project region from its S3 settings |
| `S3_ENDPOINT_URL` | Supabase project's S3 endpoint |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Supabase Storage S3 credentials scoped to this project |
| `MY_LIBRARY_ENCRYPTION_KEY` | Stable Fernet key from the platform secret manager |

Generate a Fernet key locally and paste it directly into the secret manager; do
not send or commit its output:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

The app applies SQL files in `migrations/` under a PostgreSQL advisory lock at
startup. The database user needs permission to create tables and indexes. Back
up the database before applying future migrations.

## GitHub Actions backup secrets

Add these in GitHub **Settings → Secrets and variables → Actions**. The workflow
runs daily and can also be started manually. `AGE_RECIPIENT` is a public
encryption recipient and belongs in Actions variables; keep its private key
offline in a password manager or encrypted offline storage.

| Name | Kind | Value |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Secret | Supabase PostgreSQL connection string; use a session pooler URL if the direct IPv6 endpoint is unreachable from Actions |
| `SUPABASE_STORAGE_ENDPOINT` | Secret | Project S3 endpoint, e.g. `https://<project-ref>.storage.supabase.co/storage/v1/s3` |
| `SUPABASE_STORAGE_REGION` | Secret | Supabase project's S3 region |
| `SUPABASE_STORAGE_BUCKET` | Secret | My Library's private upload bucket |
| `SUPABASE_S3_ACCESS_KEY_ID` | Secret | Supabase Storage S3 access key |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | Secret | Supabase Storage S3 secret key |
| `R2_BACKUP_ENDPOINT` | Secret | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BACKUP_BUCKET` | Secret | Dedicated private backup bucket |
| `R2_BACKUP_ACCESS_KEY_ID` | Secret | R2 token scoped to the backup bucket |
| `R2_BACKUP_SECRET_ACCESS_KEY` | Secret | Matching R2 secret |
| `AGE_RECIPIENT` | Variable | Public `age1...` recipient from `age-keygen` |

Generate the keypair without putting the private identity in the repository:

```bash
age-keygen -o age-identity.txt
age-keygen -y age-identity.txt
```

Store the second command's public output in `AGE_RECIPIENT`. Keep the private
file offline; if it is lost, the encrypted backups cannot be decrypted.
Also save the app's `MY_LIBRARY_ENCRYPTION_KEY` in the same offline password
manager. The database backup contains encrypted user API keys but deliberately
does not contain the decryption key.

Do not reuse the app's Supabase Storage credentials for R2. The R2 backup token
needs only backup-bucket object access. GitHub Actions stores the database and
provider credentials as encrypted secrets; the workflow never prints them. A
GitHub-hosted runner temporarily downloads and handles plaintext source data
before encryption, then the ephemeral runner is discarded. Treat GitHub Actions
as a data processor for these resumes; the workflow does not upload plaintext
GitHub artifacts. If this processing location is not acceptable, do not enable
the schedule; use a trusted self-hosted backup machine instead.

## Object storage

The Supabase upload bucket must be private. The app never creates public or
presigned file URLs; downloads go through an authenticated API route that
verifies account ownership. Supabase Storage controls encryption at rest, and
the app uses `S3_SERVER_SIDE_ENCRYPTION=NONE` because Supabase's S3 API does not
accept AWS SSE headers. S3 versioning is not supported there; the independent
encrypted R2 snapshots protect against accidental object deletion.

## Restore a backup

1. Temporarily suspend the Render web service to prevent writes during recovery.
2. On a trusted machine with Docker, `age`, AWS CLI, and `boto3` installed, set
   the R2 download credentials from the password manager and download the
   selected encrypted snapshot:

   ```bash
   AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID" \
   AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY" \
   aws s3 cp "s3://$R2_BACKUP_BUCKET/my-library/daily/<snapshot>.tar.gz.age" \
     backup.tar.gz.age --endpoint-url "$R2_BACKUP_ENDPOINT" --region auto
   ```

3. Load `AGE_IDENTITY_FILE`, `DATABASE_URL`, `SUPABASE_STORAGE_ENDPOINT`,
   `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_BUCKET`,
   `SUPABASE_S3_ACCESS_KEY_ID`, and `SUPABASE_S3_SECRET_ACCESS_KEY` from the
   password manager into the trusted shell environment. Confirm
   `DATABASE_URL` points to the intended project: this operation replaces the
   app's tables and bucket objects.
4. Run the tested restore tool, explicitly confirming the destructive database
   replacement:

   ```bash
   RESTORE_CONFIRM=YES python3 scripts/restore_cloud_backup.py backup.tar.gz.age
   ```

   The tool decrypts and verifies the archive, uploads and size-checks objects
   first, then restores the database tables in one transaction. If an object
   upload fails, the current database is left untouched. Session rows are
   omitted, so users sign in again after restoration.
5. Resume the Render service, sign in with an existing account, and verify
   library contents and file downloads.

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

1. Create a Supabase Free project with a private Storage bucket and a dedicated
   private R2 backup bucket.
2. Configure Render secrets, GitHub Actions secrets, `AGE_RECIPIENT`, and the
   offline age private key. Never copy `storage/` or a private key into Git.
3. Build `cloud/Dockerfile`, deploy behind the provider's HTTPS endpoint, and
   verify `/api/health` reports `mode: cloud`.
4. Run the backup workflow manually; confirm the R2 object exists and is
   encrypted. Restore it to a disposable Supabase project before inviting users.
5. Test account creation, sign-in after browser restart, two-account data
   isolation, file upload/download/delete, AI key replacement/removal, app
   restart, and recovery from the encrypted backup.
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
