# Database migrations

A migration is an ordered, versioned SQL source file. In hosted mode the server
applies unapplied files once at startup under a PostgreSQL advisory lock and
records each filename in `schema_migrations`. Local development continues to
use `storage/library.json` unless cloud variables are configured.

`001_initial_schema.sql` creates the owner-scoped records and hashed-session
tables used by the cloud adapter. It contains no user data. Back up the
database before adding future migrations.

Never place a real API key, password hash, resume text, storage export, or
uploaded file inside this folder.
