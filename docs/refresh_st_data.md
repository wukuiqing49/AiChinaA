# ST 历史数据刷新说明

本项目已经支持拉取并发布 ST、*ST、退市和 PT 股票。下载采用检查点增量模式：已有成功记录只补最新交易日，缺失记录会从历史起始日下载，重复执行不会重复下载完整历史。

## 回家后执行

在项目根目录 `C:\work\AI\AiChinaA` 打开 PowerShell：

```powershell
.\.venv\Scripts\python.exe --version
.\refresh_st_data.ps1
```

脚本会依次完成：

1. 应用远程 D1 数据库迁移并部署 Worker。
2. 修复本地历史数据的证券名称。
3. 仅下载 ST/退市/PT 股票历史数据，并使用检查点续传。
4. 获取实时行情（腾讯失败时使用新浪备用源）。
5. 重建筛选数据并发布到官网。

## 常用参数

```powershell
# 使用 8 个并发下载；网络不稳定时可改回 2 或 4
.\refresh_st_data.ps1 -Workers 8

# 只处理本地数据，不重新部署 Worker
.\refresh_st_data.ps1 -SkipDeploy
```

中途按 `Ctrl+C` 可以停止。再次运行同一命令即可从检查点继续，已经成功保存的历史记录不会重新下载。

## 检查结果

下载阶段应看到类似：

```text
Total targets to process: 145
Pending downloads: ...
Progress: ... saved
```

发布成功时会看到：

```text
{"status": "completed", "rowCount": ...}
```

官网默认筛选隐藏 ST，但按股票代码或名称搜索仍可查到 ST。例如可访问：

```text
https://a-share-quant-app.developermantou.workers.dev/api/screener?code=600745&page=1&pageSize=10
```

若需要查看下载日志，可在另一个 PowerShell 窗口运行：

```powershell
Get-Content data\historical\download-history.log -Wait
```
