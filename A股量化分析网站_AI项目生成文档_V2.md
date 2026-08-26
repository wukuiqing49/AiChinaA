# A股量化分析网站：AI 项目生成文档 V2

> 用途：将本文档完整交给 Codex、Claude Code、Gemini CLI 等编码 AI，按阶段生成一个可以长期运行的个人 A 股量化分析网站。  
> 架构基线：GitHub + GitHub Actions + Cloudflare Workers + D1 Free + R2 Standard。  
> 当前资源：用户已有 GitHub 仓库和 Cloudflare 账号；开发前期没有也不需要任何 Token。  
> 数据用途：仅限个人、非商业研究，不构成投资建议。

---

## 0. 给开发 AI 的总指令

你是该项目的主开发工程师。请在当前仓库中实现一个**个人自用的 A 股量化分析与筛选网站**。

必须实现真实数据链路、可恢复的数据初始化、十年日行情归档、交易日缺口补齐、指标计算、横截面评分、自定义筛选、市场热力图、板块分析、市场信号、每日候选、个股详情和候选历史表现。

最终运行时禁止使用 Mock 数据。测试中允许使用固定 fixture 和构造数据验证算法，但 fixture 不得进入生产数据链路。

开发优先级：

1. 数据正确性和口径可解释
2. 数据可恢复性与幂等
3. 免费额度内的容量和请求控制
4. 查询性能
5. UI/UX
6. 扩展能力

必须遵守：

- 不实现自动交易和自动下单。
- 不把评分称为“上涨概率”。
- 不生成确定性投资建议。
- 不用 AI 编造候选理由，理由必须来自真实指标。
- 不把 AKShare 调用散落到业务代码。
- 不把 Token 写入仓库、前端 bundle、日志或测试 fixture。
- 不因为缺失数据而伪装成最新或完整。
- 不一次生成大量未经构建和测试的代码。
- 每个 Phase 完成后运行 lint、typecheck、test、build，修复后再继续。
- Gate 未通过时停止扩展后续功能，先修复或执行文档规定的降级方案。

除非进入远端资源创建和部署阶段，否则不要向用户索要 Cloudflare 或 GitHub 凭据。开发阶段使用本地 D1、临时目录和固定测试 fixture。

---

## 1. 已冻结的项目决策

以下决定不再重复询问用户：

- GitHub 使用私人仓库。
- 覆盖沪市、深市、创业板、科创板和北交所 A 股。
- 目标保存最近十年日行情；数据源无法提供的历史部分必须记录缺口，不得伪造。
- 沪深 300 作为默认表现基准。
- 时区统一使用 `Asia/Shanghai`。
- 市场数据默认完成时间为 `16:30`，配置项名为 `MARKET_DATA_READY_TIME`。
- Cloudflare D1 只保存最新查询状态、轻量业务历史和同步元数据。
- Cloudflare R2 保存十年压缩行情、估值、评分和冷历史。
- GitHub Actions 负责每日数据抓取、计算、发布和完整性修复。
- 初次十年历史初始化优先在本地分片执行，不要求一个 GitHub Actions job 完成。
- 正式候选表现从项目上线日起进行不可变追踪。
- 没有可靠公告日的历史财务数据不得用于历史评分。

---

## 2. 产品定位和 V1 范围

这是个人金融研究工作台，不是财经资讯门户。

核心体验：

- 打开网站立即看到最近一个完整交易日的数据。
- 数据落后时继续展示旧数据，同时在后台触发幂等补齐。
- 页面明确显示数据日期、同步状态和数据完整度。
- 每个完整交易日对全市场计算指标和七维评分。
- 自动生成少量结构化候选，不输出交易指令。
- 用户可以任意组合白名单指标筛选股票。
- 提供市场热力图、行业/概念、市场信号和个股详情。
- 保存候选原始快照，并在未来交易日到达后补充真实表现。

V1 必须实现：

- 十年日行情归档，实际覆盖由 Provider 能力决定。
- 最近至少 300 个交易日滚动计算状态。
- 股票列表、交易日历、指数行情和最新基础数据。
- 技术、动量、量价、位置、风险因子。
- 有可靠公告日时启用成长和质量因子。
- 有可靠历史估值时启用估值历史分位。
- 七维评分、5 类候选和结构化理由。
- Dashboard、Screener、Picks、Sectors、Signals、Stock Detail、Settings。
- 定时同步、网站打开补漏、每周完整性检查。
- 从上线日起追踪 1/5/20/60 日表现和沪深 300 超额收益。

允许降级但必须明确展示：

- 历史资金流从上线日起积累。
- 概念历史成员无法取得有效期时，只展示当前成员关系。
- 历史估值不足时不计算历史分位。
- 历史财务公告日不可靠时，历史基本面因子标为 unavailable。
- 免费数据无法覆盖退市股时，历史研究标记为存在幸存者偏差。

不需要：

- 用户注册、会员、广告、社区。
- 新闻瀑布流。
- 实时 Level-2。
- 自动交易和订单系统。
- 对公众提供商业数据服务。

---

## 3. 技术栈

### 3.1 Monorepo

- pnpm workspace
- 当前维护中的 Node.js LTS，并通过 `.nvmrc` 和 `package.json#engines` 固定
- Python 3.12
- uv 管理 Python 依赖和锁文件

### 3.2 前端

- React
- TypeScript
- Vite
- React Router
- Apache ECharts
- CSS Modules
- Zod 用于运行时 API 数据校验
- Vitest + React Testing Library
- Playwright 端到端和视觉检查

### 3.3 Worker

- Cloudflare Workers
- TypeScript
- Hono
- Zod
- D1 prepared statements
- R2 binding

### 3.4 数据流水线

- Python 3.12
- AKShare 作为第一 Provider
- Pandas
- PyArrow / Parquet
- SQLite 作为本地 staging 和 checkpoint
- Pytest + Ruff

### 3.5 自动任务

- GitHub Actions `schedule`
- GitHub Actions `workflow_dispatch`
- 工作流 `concurrency`
- 每周 integrity check

---

## 4. 总体架构

```text
Browser
  -> Cloudflare Worker
       -> D1 quant-core
            最新股票状态、筛选、候选、同步、配置版本
       -> R2 quant-history
            十年行情、历史估值、历史评分、板块和信号冷历史
       -> GitHub Actions workflow_dispatch
            仅在数据库原子锁成功后触发

GitHub Actions / local pipeline
  -> DataProvider
  -> local staging SQLite / rolling Parquet
  -> validation
  -> factors / scores / picks / signals / performance
  -> D1 UPSERT
  -> R2 versioned objects
  -> atomic manifest publish
```

架构原则：

- D1 目标始终小于 350 MB，给 500 MB Free 单库限制保留安全空间。
- R2 Standard 目标小于免费额度 10 GB；每次发布记录实际字节数。
- 不在 D1 保存全市场十年 `daily_quotes` 和 `daily_score`。
- Screener 只查询 D1 的 `stock_latest`。
- 个股历史由 Worker 从 R2 按股票和年份读取。
- 大规模因子计算在 Python 中完成，不在 Worker 请求过程中计算全市场。
- R2 对象先上传到新版本路径，校验成功后再切换 manifest。
- 任何失败都不能让前端看到半发布数据。

---

## 5. R2 数据布局

Bucket：`quant-history`

```text
manifests/current.json
manifests/runs/{run_id}.json

quotes/{code}/{year}.json.gz
valuations/{code}/{year}.json.gz
scores/{code}/{year}.json.gz
financials/{code}.json.gz

market/overview/{year}.json.gz
market/index/{index_code}/{year}.json.gz
sectors/{sector_type}/{year}.json.gz
sectors/current/{sector_id}.json.gz
signals/{year}/{trade_date}.json.gz

state/rolling_quotes_300d.parquet
state/latest_financials.parquet
state/latest_valuations.parquet

backups/core/{date}.sql.gz
reports/import/{run_id}.json
```

R2 对象要求：

- JSON 使用 UTF-8 和稳定字段顺序，并使用 gzip。
- 数值字段保留数值类型，不把 `null` 写成 `0`、`-` 或空字符串。
- 每个对象包含或通过 manifest 关联 `schema_version`、`run_id`、`source`、`generated_at`、`row_count`、`sha256`。
- 股票代码始终是字符串，保留前导零。
- 当前年份对象允许每日覆盖；已结束年份对象默认不可变，修复时生成新 run 版本并记录原因。
- Worker 不允许列出整个 bucket 来寻找数据，所有路径从 manifest 或确定性 key 得到。

`manifests/current.json` 至少包含：

```json
{
  "schemaVersion": 1,
  "runId": "2026-08-26T09-00-00Z",
  "dataDate": "2026-08-26",
  "lastCompleteTradeDate": "2026-08-26",
  "datasets": {
    "quotes": { "status": "complete", "through": "2026-08-26" },
    "scores": { "status": "complete", "through": "2026-08-26" },
    "fundFlow": { "status": "optional", "through": "2026-08-26" }
  }
}
```

---

## 6. D1 数据库

Database：`quant-core`

### 6.1 必要表

#### `stocks`

```text
code PK
name
market
board
industry_id
list_date
delist_date
is_st
status
source
updated_at
```

#### `trade_calendar`

```text
trade_date PK
market
is_open
previous_trade_date
next_trade_date
source
updated_at
```

#### `stock_latest`

每只股票一行，保存筛选和首页所需最新状态：

```text
code PK
name
trade_date
industry_id
concepts_json
close
pct_change
volume
amount
turnover_rate
market_cap
float_market_cap
pe_ttm
pb
ps_ttm
dividend_yield
revenue_yoy
profit_yoy
profit_yoy_accel
roe
roa
gross_margin
net_margin
debt_ratio
ocf_to_profit
ret_5d
ret_20d
ret_60d
ret_120d
ret_250d
ma5
ma20
ma60
ma250
ma20_slope
ma60_slope
rsi14
volume_ratio_5
volume_ratio_20
distance_high_20
distance_high_60
distance_high_250
distance_low_250
price_percentile_250
volatility_20
volatility_60
max_drawdown_60
beta_60
relative_strength_20
relative_strength_60
score_valuation
score_quality
score_growth
score_trend
score_momentum
score_volume_price
score_risk
score_total
rank_total
data_completeness
config_version
tags_json
updated_at
```

D1 单表最多 100 列，因此实现 migration 前必须统计列数。若超过 85 列，把低频展示字段拆到 `stock_latest_detail`，不要逼近硬上限。

#### `financial_latest`

```text
code PK
report_date
announce_date
revenue
revenue_yoy
net_profit
profit_yoy
deducted_profit_yoy
roe
roa
gross_margin
net_margin
debt_ratio
operating_cash_flow
ocf_to_profit
source
fetched_at
```

完整财务报告历史保存在 R2 `financials/{code}.json.gz` 和 `state/latest_financials.parquet`。D1 只保存每只股票当前已生效的最新财务状态，避免首次导入触发 Free 计划每日写入上限。

#### `sectors`

```text
sector_id PK
sector_type
name
source
source_definition
updated_at
```

行业一对一关系保存在 `stock_latest.industry_id`，概念列表保存在 `stock_latest.concepts_json`。完整板块成员及可得的有效期历史保存在 R2，当前板块成员使用确定性路径 `sectors/current/{sector_id}.json.gz`，避免把大规模概念多对多关系写入 D1。

#### `sector_latest`

只保存当前完整交易日：

```text
trade_date
sector_id
pct_change
amount
main_net_inflow
main_net_inflow_ratio
up_count
down_count
strength_5d
strength_20d
source_definition
PRIMARY KEY(trade_date, sector_id)
```

#### `daily_picks`

```text
trade_date
list_type
code
rank
score
reasons_json
config_version
created_run_id
return_1d
return_5d
return_20d
return_60d
benchmark_return_1d
benchmark_return_5d
benchmark_return_20d
benchmark_return_60d
excess_return_1d
excess_return_5d
excess_return_20d
excess_return_60d
performance_status
PRIMARY KEY(trade_date, list_type, code, config_version)
```

候选原始日期、类型、排名、分数和理由不可覆盖。未来只允许补充表现字段。

#### `signal_members_latest`

仅保存最近完整交易日的信号成员，历史归档 R2：

```text
trade_date
signal_key
code
value_json
PRIMARY KEY(trade_date, signal_key, code)
```

#### `sync_state`

```text
id PK CHECK(id = 1)
status
target_date
last_complete_trade_date
requested_at
started_at
finished_at
lease_expires_at
github_run_id
run_id
error_code
error_message
updated_at
```

状态：`idle | pending | running | success | failed`。

#### `sync_runs`

保存每次同步审计历史：

```text
run_id PK
trigger_type
status
target_date
started_at
finished_at
github_run_id
error_code
error_message
metrics_json
```

#### `dataset_import_status`

```text
trade_date
dataset
status
expected_count
actual_count
source
run_id
error
updated_at
PRIMARY KEY(trade_date, dataset)
```

状态：`pending | complete | partial | failed | unavailable | optional`。

#### `config_versions`

保存 factor、score、strategy、signal 配置摘要和版本。

### 6.2 D1 保留策略

- `stock_latest`：始终每股一行。
- `financial_latest`：每股一行；完整财务历史保存在 R2。
- `daily_picks`：长期保留，数据量较小。
- `sync_runs`：保留最近 365 天，更早归档 R2。
- `dataset_import_status`：保留最近 365 天，更早归档 R2。
- `sector_latest`、`signal_members_latest`：完成新交易日后替换旧日成员，历史先归档 R2。
- 每次完整同步后记录 D1 实际大小；达到 350 MB 发出告警，达到 400 MB 阻止非必要写入并执行归档。
- 每次同步记录 D1 `rows_written`；正常日目标低于 80,000，给 Free 计划每日 100,000 行写入限制保留余量。索引更新也计入写入量，`stock_latest` 只建立经过查询验证的必要索引。

---

## 7. DataProvider

禁止业务代码直接调用 AKShare。

```python
class StockDataProvider(Protocol):
    def capabilities(self) -> ProviderCapabilities: ...
    def get_trade_calendar(self, start, end): ...
    def get_stock_list(self, as_of=None): ...
    def get_daily_quotes(self, trade_date=None, codes=None, start=None, end=None): ...
    def get_index_quotes(self, codes, start, end): ...
    def get_daily_valuation(self, trade_date=None, codes=None, start=None, end=None): ...
    def get_financial_reports(self, codes, start_report_date=None): ...
    def get_industries(self): ...
    def get_concepts(self): ...
    def get_sector_members(self, sector_id): ...
    def get_sector_fund_flow(self, sector_type, trade_date=None): ...
    def get_stock_fund_flow(self, codes, trade_date=None): ...
```

第一版实现 `AkShareProvider`，并预留其他 Provider。

每个返回值必须包含或伴随：

```text
source
source_version
fetched_at
requested_range
row_count
warnings
```

必须实现：

- 连接超时和总超时。
- 指数退避、jitter 和最大重试次数。
- 限速和并发上限。
- 结构化日志。
- 列名和单位校验。
- Provider schema drift 检测。
- 单只股票失败进入 retry queue，不让整个初始化不可恢复。
- live smoke test 与普通单元测试分离。

Provider 必须通过能力探针后才可用于生产。例如免费接口不能按交易日批量补历史时，要记录性能并采用分片，不允许隐藏数千次逐股请求的成本。

---

## 8. 数据正确性规则

### 8.1 交易日期

- Worker 必须读取 `trade_calendar`，不得使用周一至周五推测交易日。
- `16:30` 前目标为上一完整交易日。
- `16:30` 后当天为开市日时可以尝试同步当天。
- 数据行存在不代表当日完整，只有 required datasets 全部 complete 才能更新 `last_complete_trade_date`。

### 8.2 财务时点

历史交易日只能使用当日已经公开的财务数据：

```text
financial_report.announce_date <= trade_date
```

公告日未知时，不允许把该财务数据加入历史评分。相同报告期的修订按当时已知的最高 revision 使用。

### 8.3 价格和复权

- K 线显示不复权 OHLC。
- 技术指标统一使用文档冻结的复权序列。
- 不复权、前复权、后复权数据不得混算。
- 存储 source 提供的复权方式和版本。
- 公司行为导致历史复权值变化时，生成新 run 并重算受影响指标，不静默改写候选历史。

### 8.4 候选表现

默认可执行研究口径：信号生成后的下一交易日开盘进入，到第 N 个交易日收盘结束。沪深 300 使用相同起止区间。

停牌、涨跌停无法成交、未来日期未到必须标记状态，不能写成收益 0。

### 8.5 偏差声明

若免费 Provider 无法提供完整历史退市股票池，历史回算必须显示“当前可得股票池回顾性研究，存在幸存者偏差”。从上线日起保存的不可变候选可以作为正式历史验证样本。

---

## 9. Factor Registry 和评分

因子必须配置化：

```json
{
  "key": "roe",
  "name": "ROE",
  "category": "quality",
  "type": "number",
  "unit": "%",
  "direction": "higher_better",
  "filterable": true,
  "scorable": true,
  "operators": [">", ">=", "<", "<=", "between"],
  "minObservations": 1,
  "missingPolicy": "exclude_and_reweight"
}
```

V1 因子：

- 估值：PE(TTM)、PB、PS、股息率、可用时的历史分位。
- 成长：营收同比、净利润同比、扣非同比、3 年 CAGR、利润增长加速度。
- 质量：ROE、ROA、毛利率、净利率、经营现金流/净利润、资产负债率。
- 趋势：MA 关系、MA slope、多头排列。
- 动量：5/20/60/120/250 日收益、RSI14、相对沪深 300 强度。
- 量价：5/20 日量比、均量关系、换手率、成交额。
- 位置：距 20/60/250 日高点、距 250 日低点、250 日价格分位。
- 风险：20/60 日波动率、最大回撤、Beta、ST、退市风险。
- 市场：行业、概念、市值、上市交易日数。

默认维度权重：

```text
质量       20%
成长       20%
趋势       20%
估值       15%
动量       10%
量价       10%
风险        5%
```

评分规则：

- 优先使用当日全市场横截面 percentile rank。
- `higher_better` 使用 percentile。
- `lower_better` 使用 `100 - percentile`。
- 负 PE 不作为低估值高分。
- 缺失因子不计 0 分，按有效权重重新归一化。
- 保存 `data_completeness`。
- 完整度低于策略阈值不得进入候选。
- 固定 percentile tie 方法、winsorize 规则和最小样本。
- 每次评分保存 `config_version`。

---

## 10. 每日候选和市场信号

每日生成：

- 综合精选 Top10
- 低估成长 Top10
- 趋势增强 Top10
- 放量突破 Top10
- 超跌修复 Top10

先执行硬过滤：

- 非 ST。
- 非退市整理和明确退市风险。
- 上市超过配置交易日数。
- 非长期停牌。
- 成交额高于阈值。
- 数据完整度高于阈值。

每个候选生成 3–5 个结构化理由。理由保存 factor key、真实值、分位、方向和展示文本模板所需参数。

信号至少包括：

- 放量上涨、放量下跌、缩量上涨、缩量回调。
- 突破 20/60/250 日新高。
- 跌破 MA20、MA60。
- MA5 上穿 MA20。
- MA20 > MA60、MA60 > MA250、多头排列。
- 连续上涨、连续缩量、底部放量、超跌修复。
- 低估值高 ROE、低估值成长、利润加速。

“上穿/跌破”必须比较前一交易日和当前交易日，不能只检查当前静态关系。

---

## 11. 自定义 Screener

请求结构：

```json
{
  "logic": "AND",
  "rules": [
    { "field": "pe_ttm", "op": "between", "value": [0, 20] },
    { "field": "roe", "op": ">=", "value": 12 },
    { "field": "profit_yoy", "op": ">=", "value": 15 }
  ],
  "sort": [
    { "field": "score_total", "direction": "desc" }
  ],
  "limit": 100,
  "cursor": null
}
```

支持：`>`、`>=`、`<`、`<=`、`=`、`!=`、`between`、`in`、`not_in`。

安全要求：

- field、operator、sort 使用服务器白名单映射。
- 所有值使用参数绑定。
- 前端不能提交 SQL。
- 限制最多 20 条规则、`in` 最多 100 项、limit 最大 200。
- API 支持 cursor 或稳定分页。
- 筛选模板第一版保存在 localStorage，包含 schema version。

---

## 12. 同步与自动补齐

### 12.1 三层触发

1. 工作日 17:00 Asia/Shanghai 定时同步。
2. 网站打开调用 `POST /api/sync/check`，存在真实缺口时触发补漏。
3. 每周运行完整性巡检并修复。

### 12.2 同步锁

Worker 使用 D1 原子条件更新抢锁，并设置 `lease_expires_at`。只有更新影响 1 行时才允许调用 GitHub Actions。

公开 `sync/check`：

- 不接受目标日期。
- 不接受仓库、分支或 workflow 参数。
- Worker 自行读取日历和完整状态。
- 无缺口返回 no-op。
- 已有任务返回当前任务。
- 增加 IP/全局限速，但正确性不依赖 IP。

GitHub Actions 同时使用固定 `concurrency.group`，形成第二层互斥。

### 12.3 Action 执行流程

```text
启动
  -> 查询 D1 last_complete_trade_date
  -> 重新计算真实交易日缺口
  -> 标记 running 并续租
  -> 按日期顺序抓取 required datasets
  -> 写 staging
  -> 校验 expected / actual / duplicates / ranges
  -> 更新 rolling state
  -> 计算 factors / scores / picks / signals / performance
  -> 上传 R2 versioned objects
  -> UPSERT D1 latest/business data
  -> 更新 dataset_import_status
  -> required datasets 全 complete
  -> 切换 R2 manifest
  -> 更新 last_complete_trade_date
  -> sync success
```

任何步骤失败：

- 标记具体 dataset 和错误。
- 不移动 `last_complete_trade_date`。
- 不切换 current manifest。
- staging 和已上传 versioned objects可供重试复用。
- 下次从 checkpoint 继续。

---

## 13. API

统一响应 metadata：

```json
{
  "data": {},
  "meta": {
    "dataDate": "2026-08-26",
    "generatedAt": "2026-08-26T09:10:00Z",
    "runId": "...",
    "sourceStatus": "complete"
  }
}
```

至少实现：

```text
GET  /api/health
GET  /api/sync/status
POST /api/sync/check

GET  /api/market/overview?date=
GET  /api/market/heatmap?date=&group=&sizeBy=

GET  /api/sectors?date=&type=industry|concept&sort=&cursor=
GET  /api/sectors/:id?date=

GET  /api/picks?date=&type=
GET  /api/picks/performance?type=&window=1|5|20|60

POST /api/screener

GET  /api/signals?date=
GET  /api/signals/:key?date=&cursor=

GET  /api/stocks/search?q=
GET  /api/stocks/:code
GET  /api/stocks/:code/history?range=&adjust=
GET  /api/stocks/:code/scores?range=
```

Worker 读取 R2 历史时：

- 校验股票代码和年份。
- 使用确定性对象 key。
- 支持 `ETag` 和长缓存；当前年份使用较短缓存。
- 不把 R2 Secret 暴露给浏览器。
- 对不存在年份返回空数据和 coverage metadata，不返回伪造值。

---

## 14. 页面和视觉要求

路由：

```text
/
/picks
/screener
/sectors
/signals
/stock/:code
/settings
```

视觉方向：`Dark Financial Terminal + Linear`，但不要做传统后台模板。

颜色：

```text
Background      #0B0F14
Surface         #111820
Surface Hover   #151D26
Border          #1E2933
Primary Text    #E6EDF3
Secondary Text  #8B949E
A股上涨         红
A股下跌         绿
```

要求：

- 桌面优先，适配 1440px、768px、390px。
- 卡片圆角不超过 8px。
- 不做巨型 Hero、玻璃拟态、渐变背景、营销 Banner 和机器人插画。
- 数字使用 `tabular-nums`。
- 数据密度高但层次清楚。
- 表格支持键盘、排序、分页和 loading/empty/error 状态。
- 图表使用 ECharts，组件卸载时释放实例。
- 所有页面持续显示数据日期，不把系统日期当数据日期。
- 所有资金流 UI 明确展示 `source_definition`。
- 不能用雷达图替代七维评分条。

首页顺序：

1. 顶部数据日期、同步状态、检查更新和股票搜索。
2. 市场概览。
3. A 股热力图。
4. 行业/概念强弱。
5. 今日候选。
6. 市场信号。
7. 昨日及历史候选表现。

热力图：

- 面积默认流通市值，可切换成交额。
- 颜色为涨跌幅，A 股红涨绿跌。
- 支持全市场/行业分组。
- hover 显示名称、代码、涨跌、价格、成交额、市值、行业和评分。
- 点击进入个股详情。
- 桌面验证全市场性能；移动端性能不足时允许截取并明确显示覆盖比例。

个股详情：

- 基本价格、行业、总分和排名。
- 不复权日 K、成交量、MA5/20/60/250。
- 七维评分条和正负面真实因素。
- 估值、财务、趋势、量价、风险、板块。
- R2 历史评分曲线和历史候选日期。
- 明确标注价格复权口径和数据 coverage。

---

## 15. 设置

V1 设置分为：

- 本地偏好：主题、表格列、筛选模板，存 localStorage。
- 本地权重试算：基于七维已计算得分重算总分，明确显示“个人试算”。
- 系统正式评分：使用仓库中受版本控制的配置，由 pipeline 计算并保存 config version。

匿名网页不能直接修改正式评分配置。需要网页管理正式配置时，必须另行加入 Cloudflare Access 或管理鉴权。

---

## 16. 项目目录

```text
/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── charts/
│   │   ├── api/
│   │   ├── hooks/
│   │   ├── types/
│   │   ├── styles/
│   │   └── utils/
│   └── package.json
├── worker/
│   ├── src/
│   │   ├── routes/
│   │   ├── repositories/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── security/
│   └── wrangler.toml
├── packages/
│   └── contracts/
├── pipeline/
│   ├── providers/
│   ├── jobs/
│   ├── storage/
│   ├── calculations/
│   ├── validation/
│   └── models/
├── config/
│   ├── factors.json
│   ├── score_weights.json
│   ├── strategies.json
│   ├── signals.json
│   └── app.json
├── migrations/
│   └── core/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── adr/
│   ├── data-dictionary.md
│   ├── factor-spec.md
│   ├── deployment.md
│   └── recovery.md
├── .github/workflows/
│   ├── ci.yml
│   ├── sync_market.yml
│   └── weekly_integrity.yml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── pyproject.toml
├── uv.lock
└── README.md
```

---

## 17. 分阶段执行

### Phase 0：数据和容量 POC

1. 检查当前仓库，不覆盖已有文件。
2. 建立最小 Python 环境和 Provider capability probe。
3. 用至少 30 个代表性证券验证各市场、ST、停牌、新股和可得退市样本。
4. 验证股票列表、交易日历、日行情、指数、财务公告日、估值、板块和资金流。
5. 模拟缺 1、5、20 个交易日，记录耗时和失败率。
6. 用 100 只股票十年样本生成 R2 目标格式，外推完整容量。
7. 冻结数据字典、复权、收益和因子公式。

Gate：核心行情最近 20 个完整交易日覆盖率不低于 99%；R2 十年外推小于 8 GB；5 日缺口能在 90 分钟内恢复。未通过时先调整 Provider、压缩布局或任务分片。

### Phase 1：项目骨架

1. 创建 pnpm monorepo、React、Worker、Python pipeline。
2. 建立共享 contract、lint、typecheck、unit test 和 build。
3. 创建 `.env.example`、`.gitignore` 和 CI。
4. 不创建真实远端资源。

Gate：干净环境按照 README 可安装；全部空骨架命令通过。

### Phase 2：D1 schema 和 API 基础

1. 完成 migration、约束和必要索引。
2. 实现本地 D1 repository。
3. 实现 API contract、统一错误、请求 ID、校验和安全头。
4. 实现 health、sync status 和股票搜索基础 API。

Gate：migration 可重复执行；恶意 field/op/sort 被拒绝；repository integration test 通过。

### Phase 3：R2 存储和初始化

1. 实现本地 R2-compatible storage interface。
2. 实现 gzip JSON、Parquet rolling state、manifest 和 checksum。
3. 实现 staging、checkpoint、dry-run 和幂等发布。
4. 完成样本十年初始化和中断恢复。
5. 完成远端初始化脚本，但没有凭据时只验证 local adapter。

Gate：重复导入不产生重复事实；中断后能续跑；半发布版本不会成为 current。

### Phase 4：指标、评分、候选和信号

1. Factor Registry 和 schema validation。
2. 技术、动量、量价、位置、风险因子。
3. as-of 财务和估值因子。
4. 七维评分和完整度。
5. 五类候选和结构化理由。
6. 市场信号。
7. 黄金样本和手工公式测试。

Gate：同一输入和配置版本重复计算完全一致；候选理由全部可追溯。

### Phase 5：同步编排

1. 目标交易日计算。
2. D1 原子锁和租约。
3. sync check API。
4. schedule + workflow_dispatch + concurrency。
5. dataset 完整性和失败恢复。
6. 前端轮询和自动刷新。
7. 并发、超时、取消、部分失败故障演练。

Gate：100 个并发 check 最多触发一个 workflow；失败日不标完整；重跑只补缺口。

### Phase 6：Screener

1. 白名单参数化 SQL repository。
2. API 分页和查询限制。
3. Registry 驱动的筛选 UI。
4. localStorage 模板版本化。

Gate：5,500 行 latest 数据常见查询 P95 小于 500ms；SQL 注入测试全部通过。

### Phase 7：Dashboard、板块和信号

1. 市场概览和数据日期。
2. 全市场热力图。
3. 行业/概念强弱和资金口径。
4. 今日候选。
5. 市场信号和成员列表。
6. stale/syncing/failed/empty 状态。

Gate：1440px、768px、390px Playwright 截图无重叠；热力图非空且可交互。

### Phase 8：个股和候选表现

1. Worker 按股票/年份读取 R2 历史。
2. K 线、成交量、均线和评分历史。
3. 财务、估值、板块和正负理由。
4. 候选不可变快照。
5. 1/5/20/60 日收益和基准超额。
6. 样本数、胜率、均值和中位数统计。

Gate：人工价格序列的收益计算一致；未来未到保持 pending；历史候选不被新配置覆盖。

### Phase 9：加固和部署

1. 限流、日志脱敏、缓存、ETag 和查询预算。
2. D1 大小和 R2 容量监控。
3. D1 export、R2 manifest 回滚和恢复演练。
4. 用户通过本机浏览器完成 `gh auth login` 和 `wrangler login`。
5. 创建 D1 `quant-core` 和 R2 `quant-history`。
6. 配置 bindings、Worker secrets 和 GitHub Actions secrets。
7. 运行远端 migration、样本发布、全量初始化和生产冒烟测试。

Gate：备份恢复实际演练通过；所有 Secret 不出现在仓库和日志；生产 API 和页面正常。

---

## 18. 密钥和部署

用户不得把 Token 粘贴到对话或提交到 Git。

GitHub Actions secrets：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
D1_DATABASE_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
SYNC_CALLBACK_SECRET
```

Worker secrets：

```text
GITHUB_TOKEN
SYNC_CALLBACK_SECRET
```

Worker 普通环境变量：

```text
GITHUB_OWNER
GITHUB_REPO
GITHUB_WORKFLOW_ID
GITHUB_REF
MARKET_DATA_READY_TIME=16:30
APP_TIMEZONE=Asia/Shanghai
R2_BUCKET_NAME=quant-history
```

权限最小化：

- GitHub fine-grained token 仅授权目标仓库 `Actions: write`。
- Cloudflare Token 仅授权目标账号的 Workers、D1 和 R2 所需权限。
- R2 access key 仅用于目标 bucket。
- `SYNC_CALLBACK_SECRET` 使用随机高熵值，并分别配置到 Actions 与 Worker。

没有凭据时，先完成所有 local adapter、测试、构建、文档和远端创建脚本，不得停止项目开发。

---

## 19. 最终验收

最终项目必须满足：

1. Clone 后按照 README 可以本地运行。
2. 前端、Worker、pipeline 均可 lint/test/build。
3. D1 migration 可以本地和远端执行。
4. 可以使用真实免费数据初始化可得的十年日行情。
5. R2 实际使用小于 10 GB 目标；超出时有明确报告和归档方案。
6. D1 实际使用小于 350 MB 目标。
7. 可以计算真实技术指标和七维评分。
8. 缺失财务因子不会被记为 0 分。
9. 可以生成 5 类每日候选和真实结构化理由。
10. 可以自由组合白名单筛选条件。
11. 首页有真实市场概览和热力图。
12. 有行业/概念板块和资金来源口径。
13. 有市场信号和成员列表。
14. 有个股十年可得行情、评分、财务和估值详情。
15. 有上线后候选历史表现。
16. 数据库落后多个交易日时可以检测真实缺口。
17. 页面重复刷新不会重复启动同步任务。
18. GitHub Actions 能按顺序补齐缺失交易日。
19. 补齐完成后页面自动更新。
20. 所有页面明确显示数据日期和 coverage。
21. Provider 接口失败时有日志、checkpoint 和恢复机制。
22. 半完成数据不会成为 current manifest。
23. Token 不出现在前端、仓库、日志和错误响应。
24. README 包含初始化、部署、同步、成本、备份和故障恢复说明。

---

## 20. 每个任务的报告格式

```text
任务：Phase N / Task N
前置条件：已满足 / 未满足
本次范围：
修改文件：
关键决策：
运行命令：
测试结果：
真实数据证据：
D1/R2 容量变化：
遗留风险：
是否通过验收：是 / 否
下一任务：
```

---

## 21. 开始执行

完整阅读本文档后：

1. 检查当前仓库和 `git status`。
2. 阅读已有可行性分析和任务书，不覆盖用户文件。
3. 输出简短 Phase 0 计划和预期目录树。
4. 立即开始 Phase 0 数据能力探针。
5. 没有 GitHub/Cloudflare Token 时使用本地 adapter 继续。
6. Phase 0 Gate 通过后再进入 Phase 1。
7. 每个 Phase 完成后实际运行测试和构建。
8. 最终部署阶段才引导用户通过浏览器登录 GitHub 和 Cloudflare。

目标不是生成演示页面，而是生成一个数据能够持续积累、失败能够恢复、容量保持在免费额度附近、指标可以持续扩展的个人 A 股量化研究工具。
