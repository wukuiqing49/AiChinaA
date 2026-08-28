# ST 历史数据刷新说明

本项目已经支持拉取并发布当前名称标记为 ST、*ST、退市或 PT 的股票。下载采用检查点增量模式：已有成功记录只补最新交易日，缺失记录会从历史起始日下载，重复执行不会重复下载完整历史。

> 数据口径：这是“当前 ST/退市/PT 标的的历史行情”，不是全市场股票的历史 ST 状态库。已经摘帽、且当前名称不再包含这些标记的股票不会被本任务纳入。

## 回家后执行

在项目根目录打开 PowerShell（脚本会自动切换到自身所在目录，不依赖固定盘符）：

```powershell
.\.venv\Scripts\python.exe --version
.\refresh_st_data.ps1
```

执行前请确认：

1. 已创建 Python 虚拟环境，且 `.venv\Scripts\python.exe` 存在。
2. 已从 `.env.example` 创建 `.env`，并设置 `PUBLISH_URL` 与 `PUBLISH_SECRET`。
3. 若不使用 `-SkipDeploy`，已安装 Node.js，并拥有目标 D1 数据库和 Worker 的部署权限。在非交互式终端（例如自动化运行环境）中，还必须设置 `CLOUDFLARE_API_TOKEN`；仅执行过 `wrangler login` 不足以完成部署。

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

# 跳过 D1 迁移与 Worker 部署；仍会下载行情并发布筛选数据
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

`rowCount` 只表示服务端已接收的行数，不等同于数据完整性。建议同时确认下载汇总中的 `failed` 为 0、最新交易日符合预期，并用代码或名称抽查官网 API 返回结果。

官网默认筛选隐藏 ST，但按股票代码或名称搜索仍可查到 ST。例如可访问：

```text
https://a-share-quant-app.developermantou.workers.dev/api/screener?code=600745&page=1&pageSize=10
```

若需要查看下载日志，可在另一个 PowerShell 窗口运行：

```powershell
Get-Content data\historical\download-history.log -Wait
```
