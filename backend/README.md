# Backend

`server.py` is the Python API and local static-file server. It handles account
registration, password hashes, uploads, Story Builder, Mock history, and the
server-side OpenAI requests. It is source code; `server.pyc` is only a Python
cache and should not be edited or committed.

Today this backend uses a local JSON data adapter for a private demo. The
`migrations/` folder documents the Postgres schema required before a public,
multi-user cloud deployment.
