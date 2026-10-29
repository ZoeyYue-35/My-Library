#!/usr/bin/env python3
"""Create an encrypted PostgreSQL + Supabase Storage backup in Cloudflare R2."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import boto3
from botocore.config import Config

BACKUP_PREFIX = "my-library/daily/"
MAX_BACKUPS = 6
MAX_DAILY_SOURCE_BYTES = int(os.environ.get("MAX_DAILY_SOURCE_BYTES", str(100 * 1024 * 1024)))
POSTGRES_IMAGE = os.environ.get("PG_DUMP_IMAGE", "postgres:17-alpine")


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Required GitHub secret or variable is missing: {name}")
    return value


def s3_client(endpoint: str, region: str, access_key: str, secret_key: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(s3={"addressing_style": "path"}),
    )


def safe_object_path(key: str) -> Path:
    raw_parts = key.split("/")
    parsed = PurePosixPath(key)
    if parsed.is_absolute() or not raw_parts or any(part in {"", ".", ".."} for part in raw_parts):
        raise RuntimeError(f"Unsafe object key returned by storage provider: {key!r}")
    if "\\" in key:
        raise RuntimeError("Storage object key contains an invalid path separator.")
    return Path(*parsed.parts)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dump_application_database(path: Path) -> None:
    command = [
        "docker", "run", "--rm", "--network", "host", "--env", "DATABASE_URL",
        POSTGRES_IMAGE, "sh", "-ec",
        "pg_dump --format=custom --no-owner --no-acl "
        "--table=public.library_records --table=public.schema_migrations "
        '--dbname="$DATABASE_URL"',
    ]
    with path.open("wb") as output:
        subprocess.run(command, check=True, stdout=output)


def estimate_database_size() -> int:
    command = [
        "docker", "run", "--rm", "--network", "host", "--env", "DATABASE_URL",
        POSTGRES_IMAGE, "sh", "-ec",
        'psql "$DATABASE_URL" --no-align --tuples-only '
        '-c "SELECT pg_database_size(current_database())"',
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return int(result.stdout.strip())


def list_storage_objects(client: Any, bucket: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, PaginationConfig={"PageSize": 1000}):
        objects.extend(page.get("Contents", []))
    return objects


def download_storage_objects(
    client: Any,
    bucket: str,
    destination: Path,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    destination.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    for entry in entries:
        key = str(entry["Key"])
        target = destination / safe_object_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(bucket, key, str(target))
        manifest.append({"key": key, "size": int(entry.get("Size", target.stat().st_size))})
    return manifest


def prune_old_backups(client: Any, bucket: str) -> None:
    paginator = client.get_paginator("list_objects_v2")
    backups: list[dict[str, Any]] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=BACKUP_PREFIX, PaginationConfig={"PageSize": 1000}):
        backups.extend(page.get("Contents", []))
    backups.sort(key=lambda entry: (entry["LastModified"], entry["Key"]), reverse=True)
    for entry in backups[MAX_BACKUPS:]:
        client.delete_object(Bucket=bucket, Key=entry["Key"])


def main() -> None:
    required("DATABASE_URL")
    source_bucket = required("SUPABASE_STORAGE_BUCKET")
    source = s3_client(
        required("SUPABASE_STORAGE_ENDPOINT"),
        required("SUPABASE_STORAGE_REGION"),
        required("SUPABASE_S3_ACCESS_KEY_ID"),
        required("SUPABASE_S3_SECRET_ACCESS_KEY"),
    )
    target_bucket = required("R2_BACKUP_BUCKET")
    target = s3_client(
        required("R2_BACKUP_ENDPOINT"),
        os.environ.get("R2_BACKUP_REGION", "auto"),
        required("R2_BACKUP_ACCESS_KEY_ID"),
        required("R2_BACKUP_SECRET_ACCESS_KEY"),
    )
    recipient = required("AGE_RECIPIENT")
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = re.sub(r"[^A-Za-z0-9_-]", "", os.environ.get("GITHUB_RUN_ID", "manual"))
    object_key = f"{BACKUP_PREFIX}{backup_id}-{run_id}.tar.gz.age"

    with tempfile.TemporaryDirectory(prefix="my-library-backup-") as temporary:
        root = Path(temporary)
        database_dump = root / "database.dump"
        object_root = root / "objects"
        manifest_path = root / "manifest.json"
        archive_path = root / "backup.tar.gz"
        encrypted_path = root / "backup.tar.gz.age"

        storage_entries = list_storage_objects(source, source_bucket)
        estimated_bytes = estimate_database_size() + sum(
            int(entry.get("Size", 0))
            for entry in storage_entries
        )
        if estimated_bytes > MAX_DAILY_SOURCE_BYTES:
            raise RuntimeError(
                f"Estimated backup source is {estimated_bytes} bytes, above the configured "
                f"free-tier safety limit of {MAX_DAILY_SOURCE_BYTES} bytes. "
                "Existing backups were kept; reduce backup data or raise the limit only after reviewing provider costs."
            )

        dump_application_database(database_dump)
        objects = download_storage_objects(source, source_bucket, object_root, storage_entries)
        source_bytes = database_dump.stat().st_size + sum(
            path.stat().st_size for path in object_root.rglob("*") if path.is_file()
        )
        if source_bytes > MAX_DAILY_SOURCE_BYTES:
            raise RuntimeError(
                f"Backup source is {source_bytes} bytes, above the configured "
                f"free-tier safety limit of {MAX_DAILY_SOURCE_BYTES} bytes. "
                "Existing backups were kept; reduce backup data or raise the limit only after reviewing provider costs."
            )
        manifest_path.write_text(json.dumps({
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "databaseTables": ["public.library_records", "public.schema_migrations"],
            "storageBucket": source_bucket,
            "objectCount": len(objects),
            "sourceBytes": source_bytes,
            "objects": objects,
            "databaseSha256": file_sha256(database_dump),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        with tarfile.open(archive_path, "w:gz") as archive:
            archive.add(database_dump, arcname="database.dump")
            archive.add(object_root, arcname="objects")
            archive.add(manifest_path, arcname="manifest.json")
        subprocess.run([
            "age", "--encrypt", "--recipient", recipient,
            "--output", str(encrypted_path), str(archive_path),
        ], check=True)

        size = encrypted_path.stat().st_size
        with encrypted_path.open("rb") as payload:
            target.put_object(
                Bucket=target_bucket,
                Key=object_key,
                Body=payload,
                ContentLength=size,
                ContentType="application/age",
            )
        saved = target.head_object(Bucket=target_bucket, Key=object_key)
        if int(saved.get("ContentLength", -1)) != size:
            raise RuntimeError("Uploaded backup size did not match the local encrypted archive.")

    prune_old_backups(target, target_bucket)
    print(f"Encrypted backup uploaded and verified: {object_key} ({size} bytes)")


if __name__ == "__main__":
    main()
