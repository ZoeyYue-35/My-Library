#!/usr/bin/env python3
"""Restore an encrypted My Library backup to Supabase PostgreSQL and Storage."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from typing import Any
from pathlib import Path, PurePosixPath

from backup_cloud import POSTGRES_IMAGE, file_sha256, required, s3_client


def extract_bundle(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            raw_parts = member.name.split("/")
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or any(part in {"", ".", ".."} for part in raw_parts):
                raise RuntimeError("Backup archive contains an unsafe path.")
            if member.isdir():
                (destination / Path(*relative.parts)).mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise RuntimeError("Backup archive contains an unsupported file type.")
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError("Could not read a file from the backup archive.")
            target = destination / Path(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def restore_database(dump_path: Path) -> None:
    command = [
        "docker", "run", "--rm", "--network", "host", "--env", "DATABASE_URL",
        "--volume", f"{dump_path.parent}:/restore:ro", POSTGRES_IMAGE,
        "sh", "-ec",
        'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error '
        '--single-transaction --dbname="$DATABASE_URL" /restore/database.dump',
    ]
    subprocess.run(command, check=True)


def verify_bundle(bundle: Path) -> tuple[Path, Path, dict[str, Any]]:
    dump_path = bundle / "database.dump"
    object_root = bundle / "objects"
    manifest_path = bundle / "manifest.json"
    if not dump_path.is_file() or not object_root.is_dir() or not manifest_path.is_file():
        raise RuntimeError("Backup is missing the database dump, manifest, or storage objects directory.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if file_sha256(dump_path) != manifest.get("databaseSha256"):
        raise RuntimeError("Database dump checksum does not match the backup manifest.")
    expected_objects = {
        str(entry["key"]): int(entry["size"])
        for entry in manifest.get("objects", [])
    }
    actual_objects = {
        path.relative_to(object_root).as_posix(): path.stat().st_size
        for path in object_root.rglob("*") if path.is_file()
    }
    if actual_objects != expected_objects:
        raise RuntimeError("Storage object list or size does not match the backup manifest.")
    if len(actual_objects) != int(manifest.get("objectCount", -1)):
        raise RuntimeError("Storage object count does not match the backup manifest.")
    return dump_path, object_root, manifest


def restore_objects(object_root: Path) -> int:
    client = s3_client(
        required("SUPABASE_STORAGE_ENDPOINT"),
        required("SUPABASE_STORAGE_REGION"),
        required("SUPABASE_S3_ACCESS_KEY_ID"),
        required("SUPABASE_S3_SECRET_ACCESS_KEY"),
    )
    bucket = required("SUPABASE_STORAGE_BUCKET")
    restored = 0
    for path in object_root.rglob("*"):
        if not path.is_file():
            continue
        key = path.relative_to(object_root).as_posix()
        with path.open("rb") as payload:
            client.put_object(
                Bucket=bucket,
                Key=key,
                Body=payload,
                ContentType="application/octet-stream",
            )
            stored = client.head_object(Bucket=bucket, Key=key)
            if int(stored.get("ContentLength", -1)) != path.stat().st_size:
                raise RuntimeError(f"Restored object failed size verification: {key}")
        restored += 1
    return restored


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("encrypted_archive", type=Path)
    args = parser.parse_args()
    if os.environ.get("RESTORE_CONFIRM") != "YES":
        raise RuntimeError("Set RESTORE_CONFIRM=YES after confirming the target project may be overwritten.")
    identity = required("AGE_IDENTITY_FILE")

    with tempfile.TemporaryDirectory(prefix="my-library-restore-") as temporary:
        root = Path(temporary)
        archive_path = root / "backup.tar.gz"
        subprocess.run([
            "age", "--decrypt", "--identity", identity,
            "--output", str(archive_path), str(args.encrypted_archive),
        ], check=True)
        extract_bundle(archive_path, root / "bundle")
        bundle = root / "bundle"
        dump_path, object_root, _ = verify_bundle(bundle)
        restored = restore_objects(object_root)
        restore_database(dump_path)
        print(f"Restore completed: My Library tables and {restored} storage objects.")


if __name__ == "__main__":
    main()
