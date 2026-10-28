# 部署迁移出现 Cloudflare 7403

`The given account is not valid or is not authorized to access this service [code: 7403]` 是 Cloudflare 对账户/访问权限的拒绝。此时尚未执行迁移 SQL，不是 0023 的 SQL 错误，也不是运行时 Worker 1102。

本项目原部署流程只上传 Worker。本次增加远程 D1 迁移，要求部署令牌能直接修改数据库；能够部署带 D1 binding 的 Worker 不代表能够通过 D1 API 执行迁移。

## 修复配置

1. Cloudflare 控制台打开 **Workers & Pages → D1 → quant-core**，确认数据库 ID 为 `05810905-06a8-4f9c-a03c-9bbed5f1b2c3`。复制它所属账户的 **Account ID**，不是 Zone ID 或数据库 ID。
2. 编辑现有部署 API Token，或创建自定义 Token。除保留 Worker 部署所需权限外，增加 **Account → D1 → Edit**（账户级 D1 编辑权限），资源范围包含上一步的同一个账户。D1 Read 不足以执行迁移；仅 Workers Scripts Edit 也不足。
3. 确认 Token 未过期，且 IP 限制允许 GitHub 托管 runner 访问。不要把 Token 写进仓库、日志或聊天。
4. GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets** 更新 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。如只是给原 Token 增加权限、Token 值未变化，无需替换其值。
5. 重新运行 **Deploy Cloudflare Worker** 的失败任务。迁移成功后才会部署 Worker，失败时保持原版本服务；不要跳过迁移继续上线新代码。

如果仍报 7403，逐一核对 Token 资源范围、账户、数据库所属关系及 Token 创建者的账户访问权限。错误本身不能唯一证明“缺少 D1 Edit”；错误 Account ID、错误 Token 或限制条件也可能导致拒绝。

## 验证

在配置相同环境变量的可信终端中运行（不会要求公开凭证）：

```sh
pnpm --filter @a-share/worker exec wrangler d1 execute quant-core --remote --command "SELECT 1 AS ok"
pnpm --filter @a-share/worker exec wrangler d1 migrations list quant-core --remote
pnpm --filter @a-share/worker exec wrangler d1 migrations apply quant-core --remote
```

前两个命令用于确认读取路径可达，不能单独证明 D1 Edit 已授权。最后一个实际应用迁移；全部成功后再部署。

官方依据：[API Token 权限](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)、[Worker binding 与资源权限](https://developers.cloudflare.com/workers/authorization/workers/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
## 发布首个 chunk 持续返回 503

`PUBLISH_FAILED` 是 Worker 捕获异常后的通用响应，不能单凭它判断为网络超时或批次过大。`begin` 成功而 `chunkIndex=0` 失败说明任务记录已可访问，但尚未确认任何数据批次；增加 Python timeout 不会修复明确返回的 HTTP 503。

在 Cloudflare Worker 日志中用响应的 `requestId` 查找异常，或在重新续传前运行 `pnpm --filter @a-share/worker exec wrangler tail --format json`。发布错误日志包含 dataset、operation、runId、chunkIndex 和底层异常 cause，不记录发布密钥或股票请求正文。日志采样可能导致旧请求无法查到；必要时在实时 tail 连接后复现。

- `PUBLISH_SCHEMA_MISMATCH`：应用远程 D1 migrations 并部署对应 Worker，再续传。
- `PUBLISH_QUOTA_EXCEEDED`：检查 D1 用量和容量，恢复可写额度后续传；勿反复重跑整套采集。
- `PUBLISH_FAILED`：检查同一 requestId 的服务端 message，保留瞬时故障重试；该响应本身不证明具体原因。

修复底层问题后使用 **Resume preserved screener publication**，输入原 GitHub Actions workflow run ID。保留原发布包和其中的 runId，不修改 chunk 大小或重新生成内容；已经接受的批次会自动跳过。发布任务过期后需重新构建发布包。
