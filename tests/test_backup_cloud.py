from __future__ import annotations

import sys
import os
import shutil
import unittest
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import backup_cloud
from backup_cloud import MAX_BACKUPS, prune_old_backups, safe_object_path
import restore_cloud_backup
from restore_cloud_backup import restore_objects, verify_bundle


class FakeS3Client:
    def __init__(self, objects):
        self.objects = objects
        self.deleted = []

    def get_paginator(self, operation):
        if operation != "list_objects_v2":
            raise AssertionError(f"Unexpected S3 operation: {operation}")
        return self

    def paginate(self, **kwargs):
        yield {"Contents": self.objects}

    def delete_object(self, **kwargs):
        self.deleted.append(kwargs["Key"])


class FakeBackupTarget(FakeS3Client):
    def __init__(self, objects, fail_verification=False):
        super().__init__(objects)
        self.fail_verification = fail_verification
        self.uploaded = None

    def put_object(self, **kwargs):
        payload = kwargs["Body"].read()
        self.uploaded = {"key": kwargs["Key"], "body": payload}
        self.objects.append({"Key": kwargs["Key"], "LastModified": datetime.now(timezone.utc)})

    def head_object(self, **kwargs):
        if self.fail_verification:
            raise RuntimeError("simulated R2 verification failure")
        return {"ContentLength": len(self.uploaded["body"])}


class FakeRestoreS3:
    def __init__(self, wrong_size=False):
        self.uploaded = {}
        self.wrong_size = wrong_size

    def put_object(self, **kwargs):
        self.uploaded[kwargs["Key"]] = kwargs["Body"].read()

    def head_object(self, **kwargs):
        size = len(self.uploaded[kwargs["Key"]])
        return {"ContentLength": size + 1 if self.wrong_size else size}


class BackupHelpersTests(unittest.TestCase):
    def test_storage_keys_map_to_relative_paths(self):
        self.assertEqual(safe_object_path("uploads/usr_a/resume.pdf"), Path("uploads/usr_a/resume.pdf"))

    def test_storage_key_path_traversal_is_rejected(self):
        for key in ("../secret", "/absolute/key", "uploads/../../secret", "uploads\\secret", "uploads//secret"):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                safe_object_path(key)

    def test_restore_manifest_verifies_database_and_object_sizes(self):
        with TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            dump = bundle / "database.dump"
            dump.write_bytes(b"valid database dump")
            object_file = bundle / "objects" / "uploads" / "user-a" / "resume.txt"
            object_file.parent.mkdir(parents=True)
            object_file.write_bytes(b"resume bytes")
            manifest = {
                "databaseSha256": hashlib.sha256(dump.read_bytes()).hexdigest(),
                "objectCount": 1,
                "objects": [{"key": "uploads/user-a/resume.txt", "size": 12}],
            }
            (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            checked_dump, checked_objects, checked_manifest = verify_bundle(bundle)

            self.assertEqual(checked_dump, dump)
            self.assertEqual(checked_objects, bundle / "objects")
            self.assertEqual(checked_manifest["objectCount"], 1)

    def test_restore_manifest_rejects_database_checksum_mismatch(self):
        with TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            (bundle / "database.dump").write_bytes(b"corrupt dump")
            (bundle / "objects").mkdir()
            (bundle / "manifest.json").write_text(json.dumps({
                "databaseSha256": "0" * 64,
                "objectCount": 0,
                "objects": [],
            }), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "checksum"):
                verify_bundle(bundle)

    def test_restore_uploads_each_object_and_verifies_size(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "uploads" / "user-a").mkdir(parents=True)
            (root / "uploads" / "user-a" / "resume.txt").write_bytes(b"resume bytes")
            client = FakeRestoreS3()
            config = {
                "SUPABASE_STORAGE_ENDPOINT": "https://supabase.invalid",
                "SUPABASE_STORAGE_REGION": "test-region",
                "SUPABASE_S3_ACCESS_KEY_ID": "test-access",
                "SUPABASE_S3_SECRET_ACCESS_KEY": "test-secret",
                "SUPABASE_STORAGE_BUCKET": "primary",
            }
            with patch.object(restore_cloud_backup, "required", side_effect=lambda name: config[name]), \
                 patch.object(restore_cloud_backup, "s3_client", return_value=client):
                restored = restore_objects(root)

            self.assertEqual(restored, 1)
            self.assertEqual(client.uploaded["uploads/user-a/resume.txt"], b"resume bytes")

    def test_restore_rejects_object_size_mismatch(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "item.txt").write_bytes(b"resume bytes")
            client = FakeRestoreS3(wrong_size=True)
            config = {
                "SUPABASE_STORAGE_ENDPOINT": "https://supabase.invalid",
                "SUPABASE_STORAGE_REGION": "test-region",
                "SUPABASE_S3_ACCESS_KEY_ID": "test-access",
                "SUPABASE_S3_SECRET_ACCESS_KEY": "test-secret",
                "SUPABASE_STORAGE_BUCKET": "primary",
            }
            with patch.object(restore_cloud_backup, "required", side_effect=lambda name: config[name]), \
                 patch.object(restore_cloud_backup, "s3_client", return_value=client):
                with self.assertRaisesRegex(RuntimeError, "size verification"):
                    restore_objects(root)

    def test_retention_keeps_six_newest_and_deletes_older_snapshots(self):
        now = datetime.now(timezone.utc)
        objects = [
            {"Key": f"my-library/daily/{index}.age", "LastModified": now - timedelta(days=index)}
            for index in range(MAX_BACKUPS + 2)
        ]
        client = FakeS3Client(objects)

        prune_old_backups(client, "backup-bucket")

        self.assertEqual(len(client.deleted), 2)
        self.assertEqual(set(client.deleted), {
            f"my-library/daily/{MAX_BACKUPS}.age",
            f"my-library/daily/{MAX_BACKUPS + 1}.age",
        })

    def test_retention_does_not_delete_when_below_limit(self):
        now = datetime.now(timezone.utc)
        objects = [
            {"Key": f"my-library/daily/{index}.age", "LastModified": now - timedelta(days=index)}
            for index in range(MAX_BACKUPS)
        ]
        client = FakeS3Client(objects)

        prune_old_backups(client, "backup-bucket")

        self.assertEqual(client.deleted, [])

    def run_backup(self, target, age_command):
        now = datetime.now(timezone.utc)
        source = FakeS3Client([])
        values = {
            "DATABASE_URL": "postgresql://backup-test.invalid/db",
            "SUPABASE_STORAGE_BUCKET": "primary",
            "SUPABASE_STORAGE_ENDPOINT": "https://supabase.invalid/storage/v1/s3",
            "SUPABASE_STORAGE_REGION": "test-region",
            "SUPABASE_S3_ACCESS_KEY_ID": "test-access",
            "SUPABASE_S3_SECRET_ACCESS_KEY": "test-secret",
            "R2_BACKUP_BUCKET": "backup",
            "R2_BACKUP_ENDPOINT": "https://r2.invalid",
            "R2_BACKUP_REGION": "auto",
            "R2_BACKUP_ACCESS_KEY_ID": "backup-access",
            "R2_BACKUP_SECRET_ACCESS_KEY": "backup-secret",
            "AGE_RECIPIENT": "age1testrecipient",
            "GITHUB_RUN_ID": "test-run",
        }

        def fake_database_dump(path):
            path.write_bytes(b"postgres dump")

        def fake_object_download(client, bucket, destination, entries):
            object_file = destination / "uploads" / "user-a" / "resume.txt"
            object_file.parent.mkdir(parents=True, exist_ok=True)
            object_file.write_bytes(b"private resume")
            return [{"key": "uploads/user-a/resume.txt", "size": 14}]

        with patch.dict(os.environ, values, clear=False), \
             patch.object(backup_cloud, "s3_client", side_effect=[source, target]), \
             patch.object(backup_cloud, "estimate_database_size", return_value=13), \
             patch.object(backup_cloud, "list_storage_objects", return_value=[{"Key": "uploads/user-a/resume.txt", "Size": 14}]), \
             patch.object(backup_cloud, "dump_application_database", side_effect=fake_database_dump), \
             patch.object(backup_cloud, "download_storage_objects", side_effect=fake_object_download), \
             patch.object(backup_cloud.subprocess, "run", side_effect=age_command):
            backup_cloud.main()

    def test_old_backups_are_pruned_only_after_verified_upload(self):
        now = datetime.now(timezone.utc)
        old_objects = [
            {"Key": f"my-library/daily/old-{index}.age", "LastModified": now - timedelta(days=index + 1)}
            for index in range(MAX_BACKUPS)
        ]
        target = FakeBackupTarget(old_objects)

        def fake_age(command, check):
            shutil.copyfile(command[-1], command[command.index("--output") + 1])

        self.run_backup(target, fake_age)

        self.assertIsNotNone(target.uploaded)
        self.assertEqual(len(target.deleted), 1)
        self.assertEqual(target.deleted[0], "my-library/daily/old-5.age")

    def test_upload_verification_failure_never_prunes_existing_backups(self):
        now = datetime.now(timezone.utc)
        old_objects = [
            {"Key": f"my-library/daily/old-{index}.age", "LastModified": now - timedelta(days=index)}
            for index in range(MAX_BACKUPS + 2)
        ]
        target = FakeBackupTarget(old_objects, fail_verification=True)

        def fake_age(command, check):
            shutil.copyfile(command[-1], command[command.index("--output") + 1])

        with self.assertRaisesRegex(RuntimeError, "verification failure"):
            self.run_backup(target, fake_age)

        self.assertEqual(target.deleted, [])

    def test_free_egress_limit_fails_before_upload_or_pruning(self):
        now = datetime.now(timezone.utc)
        old_objects = [
            {"Key": f"my-library/daily/old-{index}.age", "LastModified": now - timedelta(days=index)}
            for index in range(MAX_BACKUPS)
        ]
        target = FakeBackupTarget(old_objects)

        def fake_age(command, check):
            shutil.copyfile(command[-1], command[command.index("--output") + 1])

        with patch.object(backup_cloud, "MAX_DAILY_SOURCE_BYTES", 1):
            with self.assertRaisesRegex(RuntimeError, "free-tier safety limit"):
                self.run_backup(target, fake_age)

        self.assertIsNone(target.uploaded)
        self.assertEqual(target.deleted, [])


if __name__ == "__main__":
    unittest.main()
