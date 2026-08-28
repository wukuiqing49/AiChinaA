# Historical Data Snapshot

Create a portable snapshot after a full history download:

```powershell
.\.venv\Scripts\python.exe -m pipeline.jobs.snapshot_history `
  --output data\snapshots\historical-YYYYMMDD.zip
```

The archive contains only `stocks/`, `etfs/`, `indices/`, `checkpoints.json`, and a
SHA-256 manifest. It excludes logs and damaged checkpoint backups.

To restore on another machine, extract the archive into `data/`, then run the regular
incremental downloader. Existing checkpoint entries prevent a full re-download:

```powershell
Expand-Archive historical-YYYYMMDD.zip -DestinationPath data
.\.venv\Scripts\python.exe -m pipeline.jobs.download_history --incremental --workers 2
```

Verify an archive before restoring it:

```powershell
.\.venv\Scripts\python.exe -m pipeline.jobs.snapshot_history --verify historical-YYYYMMDD.zip
```
