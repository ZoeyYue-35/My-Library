# Database migrations

A migration is not a new database and it does not contain user data. It is a
small, ordered source file that describes a database change, such as “create
the `users` table” or “add mock interview history.” A cloud host runs each file
once against an empty or existing Postgres database and records that it has
already been applied.

The local clean release still runs from `storage/library.json`, so this folder
is intentionally a cloud-readiness blueprint only. `001_initial_schema.sql`
captures the tables needed to preserve the same account isolation, tracks,
resume sources, confirmed stories, Mock history, and encrypted key metadata
when a real Postgres adapter is added.

Never place a real API key, password hash, resume text, storage export, or
uploaded file inside this folder.
