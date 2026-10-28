# Cloud deployment boundary

`Dockerfile` packages the current browser interface and Python API for a
single-instance **staging** run. It is deliberately not a claim that the
JSON-backed app is ready for a public launch: a container's local disk may be
ephemeral and this app's in-memory sessions do not survive a restart.

Before deployment for external users, implement these adapters and test them
in a staging environment:

1. **Postgres data adapter:** replace reads/writes of `storage/library.json`
   with the schema in `../migrations/001_initial_schema.sql`.
2. **Object-storage adapter:** replace `storage/uploads/<account>/...` with a
   private bucket. Store only the object key and metadata in Postgres. Never
   make uploaded resumes public by default.
3. **Persistent authentication:** move the current in-memory session map to
   signed, short-lived, httpOnly secure cookies or a persistent session store.
4. **Secrets:** set `MY_LIBRARY_ENCRYPTION_KEY` with the cloud provider's
   secret manager before connecting any user's OpenAI key. It must remain
   stable across deploys; changing it without a re-encryption migration makes
   existing encrypted keys unreadable.
5. **Operational safeguards:** HTTPS, request-size limits, per-user rate
   limits, private logs, backups, data deletion, and a privacy notice.

The user's OpenAI key must travel only from the browser to My Library's
authenticated backend over HTTPS. The browser receives only a last-four
character hint. The backend decrypts the key only while issuing the requested
Story Builder or Mock Interview request, then returns the result—not the key.

Use the `PORT` environment variable supplied by the host. The container sets
`MY_LIBRARY_HOST=0.0.0.0`; the default local launcher remains restricted to
`127.0.0.1`.
