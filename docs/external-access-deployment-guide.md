# 外部访问部署操作手册

本文档用于把本项目部署到 Cloudflare，并通过 `workers.dev` 地址从公网访问。

项目采用：

```text
GitHub：保存代码、执行自动部署和数据任务
Cloudflare Worker：托管网站和 API
Cloudflare D1：保存账户、自选股和最新筛选数据
```

不需要购买服务器，也不需要维护传统后台。

## 一、准备条件

你需要：

- 一个 GitHub 账号和本项目仓库
- 一个 Cloudflare 账号
- Windows PowerShell
- Node.js 22 或更高版本
- 本地已安装 Python 3.12（用于数据任务）

当前代码已经推送到：

```text
https://github.com/wukuiqing49/AiChinaA
```

当前生产分支是 `main`。

## 二、下载项目并安装依赖

如果项目已经在本机，可以跳过克隆步骤。

```powershell
git clone https://github.com/wukuiqing49/AiChinaA.git
cd AiChinaA
pnpm install
```

检查代码构建：

```powershell
pnpm --filter @a-share/frontend build
pnpm --filter @a-share/worker build
```

## 三、登录 Cloudflare

在项目根目录执行：

```powershell
pnpm --filter @a-share/worker exec wrangler login
```

命令会打开浏览器。登录并授权你要部署的 Cloudflare 账号。

## 四、创建 D1 数据库

创建生产数据库：

```powershell
pnpm --filter @a-share/worker exec wrangler d1 create quant-core
```

命令输出中会包含类似内容：

```text
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

打开：

```text
worker/wrangler.toml
```

将：

```toml
database_id = "replace-at-deploy"
```

替换为真实的数据库 ID。

然后把修改提交并推送：

```powershell
git add worker/wrangler.toml
git commit -m "chore: configure production d1"
git push origin main
```

## 五、应用数据库迁移

把项目中的 4 个数据库迁移应用到 Cloudflare 远程 D1：

```powershell
pnpm --filter @a-share/worker exec wrangler d1 migrations apply quant-core --remote
```

成功后会看到以下迁移均已执行：

```text
0001_core.sql
0002_fixed_accounts.sql
0003_screener_latest.sql
0004_sync_runs.sql
```

Cloudflare 官方 D1 迁移说明：

https://developers.cloudflare.com/d1/wrangler-commands/

## 六、创建固定账户

项目不使用 Google 登录，使用固定用户名和密码。

每个账户生成一次。下面示例创建 `owner` 账户：

```powershell
$env:AUTH_USERNAME = "owner"
$env:AUTH_DISPLAY_NAME = "Owner"
$env:AUTH_PASSWORD = Read-Host "请输入账户密码"
node worker/scripts/create-fixed-account.mjs
Remove-Item Env:AUTH_USERNAME
Remove-Item Env:AUTH_DISPLAY_NAME
Remove-Item Env:AUTH_PASSWORD
```

命令会输出一行 JSON，例如：

```json
{"username":"owner","displayName":"Owner","salt":"...","passwordHash":"...","iterations":310000}
```

如果需要多个账户，重复执行上面的命令，然后把多行 JSON 合并成一个数组：

```json
[
  {
    "username": "owner",
    "displayName": "Owner",
    "salt": "...",
    "passwordHash": "...",
    "iterations": 310000
  },
  {
    "username": "member",
    "displayName": "Member",
    "salt": "...",
    "passwordHash": "...",
    "iterations": 310000
  }
]
```

## 七、设置 Cloudflare Secrets

### 7.1 固定账户

执行：

```powershell
pnpm --filter @a-share/worker exec wrangler secret put FIXED_ACCOUNTS
```

粘贴上一节生成的 JSON 数组，回车完成。

### 7.2 会话密钥

生成随机值：

```powershell
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

设置会话密钥：

```powershell
pnpm --filter @a-share/worker exec wrangler secret put SESSION_SECRET
```

把随机值粘贴进去。

### 7.3 数据发布密钥

再生成一个不同的随机值：

```powershell
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

设置发布密钥：

```powershell
pnpm --filter @a-share/worker exec wrangler secret put PUBLISH_SECRET
```

这三个值都不能提交到 GitHub 仓库：

```text
FIXED_ACCOUNTS
SESSION_SECRET
PUBLISH_SECRET
```

## 八、第一次手动部署

完成数据库和 Secret 配置后执行：

```powershell
pnpm build
pnpm --filter @a-share/worker exec wrangler deploy
```

部署成功后终端会输出类似地址：

```text
https://a-share-quant-app.xxxxx.workers.dev
```

这个地址就是网站公网地址，可以直接发给其他人访问。

检查健康接口：

```powershell
Invoke-RestMethod https://你的workers地址.workers.dev/api/health
```

预期结果：

```json
{"status":"ok"}
```

## 九、配置 GitHub 自动部署

打开 GitHub 仓库：

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

添加以下两个 Repository secrets：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

其中：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID
- `CLOUDFLARE_API_TOKEN`：用于部署 Worker 的 API Token

之后每次推送到 `main`，文件：

```text
.github/workflows/deploy-worker.yml
```

会自动执行构建和部署。

Cloudflare 官方 GitHub Actions 说明：

https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

## 十、首次发布筛选数据

网站部署后可以正常打开，但如果还没有发布数据，筛选页面会显示：

```text
暂无符合条件的数据
```

这是正常的，因为 D1 还没有最新股票数据。

发布接口地址：

```text
https://你的workers地址.workers.dev/api/internal/publish-screener
```

Python 发布器文件：

```text
pipeline/jobs/publish_screener.py
```

本地发布命令格式：

```powershell
$env:PUBLISH_URL = "https://你的workers地址.workers.dev/api/internal/publish-screener"
$env:PUBLISH_SECRET = "你设置的PUBLISH_SECRET"
python -m pipeline.jobs.publish_screener --input reports/screener-publish.json
Remove-Item Env:PUBLISH_URL
Remove-Item Env:PUBLISH_SECRET
```

发布包必须包含：

- `runId`
- `tradeDate`
- `stocks`
- 每只股票的价格、技术分、市场、行业和技术指标

Worker 会记录 `runId`、发布日期、行数和状态。已完成的 `runId` 重复发布时不会重复写入。

## 十一、外部访问验收清单

打开 Worker 地址后依次检查：

1. 页面能正常打开。
2. `/api/health` 返回 `{"status":"ok"}`。
3. 筛选页能显示数据日期。
4. 输入价格或涨幅条件后，结果数量变化。
5. 点击“账户登录”可以登录固定账户。
6. 登录后可以把股票加入自选。
7. 退出后再次登录，自选股仍然存在。
8. 推送一条新代码到 GitHub 后，GitHub Actions 显示部署成功。

## 十二、常见问题

### 页面能打开，但没有股票

说明 Worker 部署成功，但尚未向 `/api/internal/publish-screener` 发布有效筛选数据。

先生成筛选数据，再发布：

```powershell
python -m pipeline.jobs.build_screener --max-stocks 300 --workers 4
python -m pipeline.jobs.publish_screener --input reports/screener-publish.json
```

也可以在 GitHub Actions 中手动运行 `Sync stock screener data`。该工作流需要仓库 Secrets：`PUBLISH_URL` 和 `PUBLISH_SECRET`。

### 登录提示固定账户未配置

重新执行：

```powershell
pnpm --filter @a-share/worker exec wrangler secret put FIXED_ACCOUNTS
```

### 部署提示数据库 ID 无效

检查：

```text
worker/wrangler.toml
```

确认 `database_id` 已替换，且不是 `replace-at-deploy`。

### GitHub Actions 部署失败

检查 GitHub Repository secrets 是否存在：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

同时检查 Cloudflare API Token 是否有 Worker 部署权限。

### 如何停止网站

在 Cloudflare Workers & Pages 中暂停或删除对应 Worker 即可。D1 数据库需要单独删除，删除前应先确认不再需要账户和自选数据。
