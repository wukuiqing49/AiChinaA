# A股量化分析网站：AI 项目生成文档 V3

> 用途：作为本仓库后续实现的唯一执行基线。本文取代 V2 的执行顺序，但不覆盖 V2 的原始设计记录。
>
> 产品性质：个人、非商业研究工具；不提供自动交易、下单或确定性投资建议。
>
> 当前资源：GitHub 仓库、Cloudflare 账号。开发和本地验证阶段不需要 Token。

## 1. V1 结论与边界

V1 可行，但必须按以下降级范围交付：

- 支持沪深、创业板、科创板、北交所当前可得股票代码。
- 保存真实可得的十年前复权和不复权日行情；缺口必须记录，不得补造。
- 先提供趋势、动量、量价、风险四维技术评分。
- 财务质量和成长维度只在数据具备可靠 `NOTICE_DATE` 时启用。
- 历史估值和估值分位在存在可靠历史估值源之前一律显示 `unavailable`。
- 正式候选表现从网站上线后的不可变快照开始统计，不宣称为无偏历史回测。

以下不属于 V1：自动交易、Level-2、严格无幸存者偏差回测、历史概念成员回放、历史估值分位。

## 2. 已验证事实

| 项目 | 实测结果 | 结论 |
| --- | --- | --- |
| 十年行情探针 | 30 只股票、63,500 行 | 可用 |
| 最近 20 个交易日恢复 | 100 只股票、1,998 / 2,000 行、99.90% | 通过 99% Gate |
| 五日全市场恢复估算 | 四并发约 29 分钟 | 通过 90 分钟 Gate |
| 财务公告日 | 五个板块样本均有 `NOTICE_DATE` | 可用于 as-of 财务数据 |
| R2 行情归档 | 约 0.45 GiB / 十年全市场 | 可用 |
| R2 技术因子与评分归档 | 约 1.74 GiB | 可用 |
| R2 合计基线 | 约 2.19 GiB | 小于 8 GiB 目标 |
| 历史估值 | 免费接口实测失败 | V1 降级为 unavailable |

上述结论的完整原始记录位于 `docs/phase0-status.md` 和 `reports/`。

## 3. 目标架构

```text
浏览器
  -> Cloudflare Worker API
       -> D1 quant-core: 最新状态、筛选、候选、同步审计
       -> R2 quant-history: 行情、技术因子、评分、运行 manifest

本地 Python / GitHub Actions
  -> AkShareProvider（多源回退）
  -> SQLite staging + quarantine + checkpoint
  -> 行情验证 -> 因子 -> 评分 -> 候选
  -> R2 版本化对象
  -> D1 latest UPSERT
  -> 原子切换 R2 manifest
```

职责边界：

- GitHub 仅保存代码、文档、工作流和配置，不保存运行数据库或市场历史。
- D1 仅保存适合最新查询的少量数据，目标小于 350 MB。
- R2 保存追加型历史对象，所有读取路径由 manifest 或确定性 key 得到。
- Worker 不进行全市场因子计算，不暴露 R2 Secret，不直接相信前端传入的同步日期。
- 初次十年导入仅在本地分批执行；GitHub Actions 负责每日增量和补缺。

## 4. 数据口径

### 4.1 行情

- K 线展示：不复权 OHLC。
- 技术因子：仅使用 `qfq` 前复权 close。
- 每条数据或归档对象必须关联 `source`、`price_adjustment`、`fetched_at`、`run_id` 和 `schema_version`。
- `open/high/low/close` 非正数、`low > high`、重复交易日均进入 quarantine，不进入发布数据集。
- 交易日只以 `trade_calendar` 为准，禁止使用周一至周五推断。

### 4.2 财务与估值

- 历史财务只在 `NOTICE_DATE <= trade_date` 时可参与评分。
- 缺少公告日的财务源可用于展示，但不得进入历史分数。
- 历史估值源不可用时，估值因子及其评分均为 `null`，不能写成 0。
- 所有缺失评分维度从 `score_total` 的有效权重中排除。

### 4.3 评分

技术评分配置版本：`technical-v1`。

| 维度 | 输入 | 方向 |
| --- | --- | --- |
| 趋势 | `ma20_slope` | 高优 |
| 动量 | `ret_20d` | 高优 |
| 量价 | `volume_ratio_20` | 高优 |
| 风险 | `volatility_20` | 低优 |

按同一交易日有效股票横截面做平均并列排名，映射为 0 至 100 分。窗口不足的值为 `null`；`score_total` 是可用维度的均值，并输出 `data_completeness`。

## 5. R2 与 D1 布局

R2 bucket：`quant-history`

```text
manifests/current.json
manifests/runs/{run_id}.json
quotes/raw/{code}/{year}.json.gz
quotes/qfq/{code}/{year}.json.gz
factors/technical/{code}/{year}.json.gz
scores/{code}/{year}.json.gz
financials/{code}.json.gz
reports/import/{run_id}.json
state/rolling_quotes_300d.parquet
```

每个对象写入新 `run_id` 路径、计算 SHA-256、验证行数后，才更新 `manifests/current.json`。失败或部分完成的 run 不能成为 current。

D1 database：`quant-core`

| 表 | 用途 |
| --- | --- |
| `stocks` | 当前股票基础信息 |
| `trade_calendar` | 交易日历 |
| `stock_latest` | 每股一行的最新行情、因子和评分 |
| `financial_latest` | 当前已生效财务数据 |
| `daily_picks` | 不可变候选快照及后续表现 |
| `sync_state` | 单例同步锁和租约 |
| `sync_runs` | 同步审计记录 |
| `dataset_import_status` | 每日数据集完整性 |

`stock_latest` migration 前必须检查列数，小于 85 列；低频字段拆分到 `stock_latest_detail`。

## 6. 执行阶段

### Phase 0：数据与容量 POC

状态：已通过，历史估值明确降级。

产物：Provider 探针、100 代码恢复基准、R2 容量报告、技术因子口径。

### Phase 1：本地导入与质量控制

状态：进行中。

1. 实现 SQLite `daily_quotes`、`quote_quarantine` 和 checkpoint。
2. 分批导入指定股票集合和日期区间。
3. 每个代码独立记录成功、失败、重试次数、缺失交易日和来源。
4. 重跑时只补缺失代码或缺失日期；相同行情主键 UPSERT。
5. 输出每批 JSON 报告，失败代码进入 retry queue。

Gate：中断后重跑无重复事实；异常行不进入主表；缺失日期可定位；真实单股票入库验证通过。

### Phase 2：因子、评分和候选

1. 用 qfq 行情计算冻结的技术因子。
2. 计算四维横截面评分和 `data_completeness`。
3. 将不可用估值、质量、成长维度保留为 null。
4. 生成少量结构化候选及正负指标理由。
5. 所有输出关联配置版本和 run ID。

Gate：固定输入重复计算一致；理由可追溯到实际指标；缺失维度不变成 0。

### Phase 3：R2 发布与 D1 latest

1. 实现本地 R2-compatible storage adapter。
2. 写入按股票和年份分区的压缩对象。
3. 创建并验证 run manifest，再原子发布 current manifest。
4. 只向 D1 写入 latest、候选和同步元数据。
5. 本地模拟发布失败、回滚和恢复。

Gate：半发布数据不可见；manifest 回滚可用；D1 不保存全历史。

### Phase 4：Worker 与自动同步

1. 实现只读 API、Screener 查询白名单和 Zod 校验。
2. 实现 D1 原子同步锁与租约。
3. GitHub Actions 配置 `schedule`、`workflow_dispatch`、`concurrency`。
4. 同步任务自行计算缺口，按交易日顺序补齐。

Gate：100 次并发 check 至多触发一个 workflow；失败日不标 complete；重跑只补缺口。

### Phase 5：前端工作台

首批页面：Dashboard、Screener、Stock Detail、Picks、Settings。

所有页面显示数据日期、完整性和同步状态；数据过期时保留旧数据但明确标记。市场热力图、板块、信号和候选表现统计在基础 API 稳定后增加。

### Phase 6：远端部署与演练

仅在此阶段通过浏览器完成 `wrangler login`、创建 D1/R2、配置 bindings 和 GitHub Secrets。禁止在聊天、源码、日志或测试 fixture 中放入 Token。

## 7. 发布与验收

V1 通过条件：

1. 新环境可按 README 安装、测试和运行。
2. 可导入真实日行情，错误和缺口有记录。
3. 可生成真实技术因子、四维评分和不可变候选快照。
4. D1 仅提供 latest 查询；R2 历史只通过 manifest 发布。
5. 网站明确展示数据日期、完整性、估值 unavailable 和幸存者偏差声明。
6. 每日同步可重试、可补缺、不可重复触发。
7. GitHub、D1、R2 的实际用量有报告；接近额度时阻止继续写入并提示维护。

## 8. 用户需提供的内容

当前无需提供任何凭据。

进入 Phase 6 后，仅需通过浏览器完成 Cloudflare 登录和 GitHub Secrets 配置。不要将 Token 粘贴到聊天中。
