# A股量化分析网站

当前处于 Phase 0：验证免费数据源、历史数据容量与缺口补齐能力。

## 本地准备

```powershell
python -m uv sync
python -m uv run python -m pipeline.jobs.probe_provider --sample-size 5
python -m uv run pytest
python -m uv run ruff check .
```

默认探针会将原始样本写入 `data/`、将运行报告写入 `reports/`。两者均不提交到 Git。

没有 Cloudflare 或 GitHub Secret 时，仍可完成本阶段。远端资源将在本地 Gate 通过后创建。
