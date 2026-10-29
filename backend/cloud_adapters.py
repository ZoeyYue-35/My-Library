"""Managed PostgreSQL, persistent sessions, and private S3-compatible storage."""

from __future__ import annotations

import copy
import hashlib
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


COLLECTIONS = ("accounts", "items", "experiences", "stories", "mockHistories")
SNAPSHOT_KEY = "_storageSnapshot"
SESSION_DAYS = 30


class StorageConflictError(Exception):
    """A concurrent update changed the same record; callers must reload."""


def cloud_database_enabled() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip())


def cloud_objects_enabled() -> bool:
    return bool(os.environ.get("S3_BUCKET", "").strip())


def validate_cloud_configuration() -> None:
    database_configured = cloud_database_enabled()
    objects_configured = cloud_objects_enabled()
    production = os.environ.get("MY_LIBRARY_ENV", "").strip().lower() == "production"

    if database_configured != objects_configured:
        raise RuntimeError("DATABASE_URL and S3_BUCKET must be configured together.")
    if production and not database_configured:
        raise RuntimeError("Production requires managed PostgreSQL and private object storage.")
    if production and not os.environ.get("MY_LIBRARY_ENCRYPTION_KEY", "").strip():
        raise RuntimeError("Production requires MY_LIBRARY_ENCRYPTION_KEY from the host secret manager.")


def _blank_database() -> dict[str, Any]:
    return {collection: [] for collection in COLLECTIONS}


def _connect():
    import psycopg

    return psycopg.connect(
        os.environ["DATABASE_URL"],
        connect_timeout=10,
        sslmode=os.environ.get("DATABASE_SSLMODE", "require"),
    )


def apply_schema_migrations() -> None:
    migration_root = Path(__file__).resolve().parent.parent / "migrations"
    with _connect() as connection:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
        )
    for migration_path in sorted(migration_root.glob("*.sql")):
        migration_sql = "\n".join(
            line for line in migration_path.read_text(encoding="utf-8").splitlines()
            if line.strip().upper() not in {"BEGIN;", "COMMIT;"}
        )
        with _connect() as connection:
            with connection.transaction():
                connection.execute("SELECT pg_advisory_xact_lock(824617204)")
                applied = connection.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = %s",
                    (migration_path.name,),
                ).fetchone()
                if applied:
                    continue
                connection.execute(migration_sql, prepare=False)
                connection.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (migration_path.name,),
                )


def _record_map(data: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    records: dict[tuple[str, str], dict[str, Any]] = {}
    for collection in COLLECTIONS:
        for value in data.get(collection, []):
            record_id = str(value.get("id") or "")
            if record_id:
                records[(collection, record_id)] = value
    return records


def find_cloud_account_by_email(email: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT data FROM library_records WHERE collection = 'accounts' AND LOWER(data->>'email') = LOWER(%s)",
            (email,),
        ).fetchone()
    return dict(row[0]) if row and isinstance(row[0], dict) else None


def load_cloud_database(user_id: str | None = None) -> dict[str, Any]:
    data = _blank_database()
    with _connect() as connection:
        if user_id:
            rows = connection.execute(
                "SELECT collection, record_id, data FROM library_records WHERE owner_id = %s OR (collection = 'accounts' AND record_id = %s)",
                (user_id, user_id),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT collection, record_id, data FROM library_records"
            ).fetchall()
    snapshot: dict[tuple[str, str], dict[str, Any]] = {}
    for collection, record_id, value in rows:
        if collection not in COLLECTIONS or not isinstance(value, dict):
            continue
        record = dict(value)
        record["id"] = record_id
        data[collection].append(record)
        snapshot[(collection, record_id)] = copy.deepcopy(record)
    data[SNAPSHOT_KEY] = snapshot
    return data


def save_cloud_database(data: dict[str, Any]) -> None:
    from psycopg.types.json import Jsonb

    previous = data.get(SNAPSHOT_KEY, {})
    current = _record_map(data)
    changed = {
        key for key in previous.keys() | current.keys()
        if previous.get(key) != current.get(key)
    }
    if not changed:
        return

    with _connect() as connection:
        with connection.transaction():
            for collection, record_id in sorted(changed):
                old_value = previous.get((collection, record_id))
                new_value = current.get((collection, record_id))
                owner_id = record_id if collection == "accounts" else str((new_value or old_value or {}).get("ownerId") or "")
                if old_value is None:
                    connection.execute(
                        "INSERT INTO library_records (collection, record_id, owner_id, data) VALUES (%s, %s, %s, %s)",
                        (collection, record_id, owner_id, Jsonb(new_value)),
                    )
                elif new_value is None:
                    result = connection.execute(
                        "DELETE FROM library_records WHERE collection = %s AND record_id = %s AND data = %s",
                        (collection, record_id, Jsonb(old_value)),
                    )
                    if result.rowcount != 1:
                        raise StorageConflictError("This workspace changed in another request. Reload and retry.")
                else:
                    result = connection.execute(
                        "UPDATE library_records SET owner_id = %s, data = %s WHERE collection = %s AND record_id = %s AND data = %s",
                        (owner_id, Jsonb(new_value), collection, record_id, Jsonb(old_value)),
                    )
                    if result.rowcount != 1:
                        raise StorageConflictError("This workspace changed in another request. Reload and retry.")

    data[SNAPSHOT_KEY] = copy.deepcopy(current)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_cloud_session(token: str, user_id: str) -> None:
    token_hash = _token_hash(token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    with _connect() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= NOW()")
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
            (token_hash, user_id, expires_at),
        )


def cloud_session_user(token: str) -> str | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT user_id FROM sessions WHERE token_hash = %s AND expires_at > NOW()",
            (_token_hash(token),),
        ).fetchone()
    return str(row[0]) if row else None


def delete_cloud_session(token: str) -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = %s", (_token_hash(token),))


def delete_cloud_user_sessions(user_id: str) -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))


class PrivateObjectStore:
    def __init__(self) -> None:
        import boto3

        options: dict[str, Any] = {
            "region_name": os.environ.get("AWS_REGION", "us-east-1"),
        }
        endpoint = os.environ.get("S3_ENDPOINT_URL", "").strip()
        if endpoint:
            from botocore.config import Config

            options["endpoint_url"] = endpoint
            options["config"] = Config(s3={"addressing_style": "path"})
        self.client = boto3.client("s3", **options)
        self.bucket = os.environ["S3_BUCKET"]
        self.encryption = os.environ.get("S3_SERVER_SIDE_ENCRYPTION", "AES256").strip()
        self.kms_key_id = os.environ.get("S3_KMS_KEY_ID", "").strip()
        if self.encryption not in {"AES256", "aws:kms", "NONE"}:
            raise RuntimeError("S3_SERVER_SIDE_ENCRYPTION must be AES256, aws:kms, or NONE.")
        if self.encryption == "aws:kms" and not self.kms_key_id:
            raise RuntimeError("S3_KMS_KEY_ID is required when S3 server-side encryption is aws:kms.")

    @staticmethod
    def key_for(user_id: str, stored_name: str) -> str:
        return f"uploads/{user_id}/{stored_name}"

    def put(self, user_id: str, stored_name: str, payload: bytes, content_type: str) -> str:
        key = self.key_for(user_id, stored_name)
        options: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": payload,
            "ContentType": content_type,
        }
        if self.encryption != "NONE":
            options["ServerSideEncryption"] = self.encryption
        if self.encryption == "aws:kms":
            options["SSEKMSKeyId"] = self.kms_key_id
        self.client.put_object(
            **options,
        )
        return key

    def get(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)