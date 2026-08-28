from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _history_files(data_dir: Path) -> list[Path]:
    files = [data_dir / "checkpoints.json"]
    for folder in ("stocks", "etfs", "indices"):
        files.extend(sorted((data_dir / folder).glob("*.parquet")))
    return [path for path in files if path.is_file()]


def create_snapshot(data_dir: Path, output_file: Path) -> dict[str, object]:
    data_dir = data_dir.resolve()
    files = _history_files(data_dir)
    if not files or not (data_dir / "checkpoints.json").is_file():
        raise ValueError(f"No complete historical dataset found in {data_dir}")

    manifest_files = []
    for path in files:
        relative_path = path.relative_to(data_dir).as_posix()
        manifest_files.append(
            {
                "path": relative_path,
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    manifest = {
        "format": "a-share-history-snapshot/v1",
        "createdAt": datetime.now(UTC).isoformat(),
        "root": "historical",
        "fileCount": len(manifest_files),
        "totalBytes": sum(item["bytes"] for item in manifest_files),
        "files": manifest_files,
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = output_file.with_suffix(f"{output_file.suffix}.partial")
    with zipfile.ZipFile(
        temporary_file,
        "w",
        compression=zipfile.ZIP_STORED,
        allowZip64=True,
    ) as archive:
        for path in files:
            archive.write(path, Path("historical") / path.relative_to(data_dir))
        archive.writestr(
            "historical/manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )
    temporary_file.replace(output_file)
    return manifest


def verify_snapshot(snapshot_file: Path) -> dict[str, object]:
    with zipfile.ZipFile(snapshot_file) as archive:
        invalid_member = archive.testzip()
        if invalid_member:
            raise ValueError(f"Snapshot CRC validation failed: {invalid_member}")
        manifest = json.loads(archive.read("historical/manifest.json"))
        for item in manifest["files"]:
            member = f"historical/{item['path']}"
            with archive.open(member) as source:
                digest = hashlib.sha256(source.read()).hexdigest()
            if digest != item["sha256"]:
                raise ValueError(f"Snapshot SHA-256 validation failed: {member}")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or verify a portable history snapshot.")
    parser.add_argument("--data-dir", type=Path, default=Path("data/historical"))
    parser.add_argument("--output", type=Path, default=Path("data/snapshots/historical.zip"))
    parser.add_argument("--verify", type=Path, help="Verify an existing snapshot and exit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.verify:
        manifest = verify_snapshot(args.verify)
        print(f"Verified {manifest['fileCount']} files in {args.verify}")
        return 0
    manifest = create_snapshot(args.data_dir, args.output)
    print(f"Created {args.output} with {manifest['fileCount']} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
