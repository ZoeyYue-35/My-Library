# Backend

`server.py` is the Python API and static-file server. It handles account
registration, password hashes, uploads, Story Builder, Mock history, and
server-side OpenAI requests. It is source code; `server.pyc` is only a Python
cache and should not be edited or committed.

Without `DATABASE_URL` and `S3_BUCKET`, local development uses JSON and local
uploads. Hosted mode requires both, applies `migrations/` at startup, and uses
PostgreSQL-backed sessions plus private S3-compatible storage. Production also
requires `MY_LIBRARY_ENCRYPTION_KEY` from the host secret manager. See
`cloud/README.md` for the deployment boundary and release checklist.
