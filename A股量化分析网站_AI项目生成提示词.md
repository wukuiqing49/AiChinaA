# A股量化分析网站 --- AI 项目生成提示词

> 用途：将本文档整体交给 Codex / Claude Code / Gemini 等编程
> AI，从零生成一个可部署、可实际使用的完整项目。

## 0. 给开发 AI 的总指令

你现在是该项目的主开发工程师。请从零实现一个**个人自用 A
股量化分析与筛选网站**。

必须实现真实数据链路、数据库、历史初始化、缺失交易日自动补齐、指标计算、多因子评分、自定义筛选、市场热力图、板块分析、资金流、个股详情以及
Cloudflare 部署。

**不要只做 UI Demo，不要使用 Mock 数据替代最终数据链路。**

开发优先级：

1.  数据正确性
2.  数据可恢复性
3.  查询性能
4.  UI/UX
5.  扩展能力

每完成一个阶段必须自行构建、运行测试并修复错误，再进入下一阶段。

免费数据源可能发生接口变化，因此必须通过 `DataProvider` 抽象隔离。

不要实现自动交易，不要将评分描述为"上涨概率"，不要生成确定性的投资建议。

------------------------------------------------------------------------

# 1. 项目定位

这是一个**个人自用的 A 股 Quant Dashboard**，不是财经资讯门户。

核心体验：

-   打开网站立即看到最近一个完整交易日的数据。
-   如果数据库缺少最近几个交易日的数据，网站自动检测并触发补齐。
-   补数据期间仍然展示数据库已有的最近数据。
-   补齐完成后页面自动刷新。
-   每天自动对全 A 股评分并生成少量候选股。
-   可以自己任意组合条件筛选股票。
-   可以查看市场热力图、行业/概念板块、资金流、市场信号和个股详情。
-   保存历史评分和每日候选，后续验证评分体系是否真的有效。

不需要：

-   用户注册
-   登录
-   会员
-   广告
-   社区
-   新闻瀑布流
-   自动下单
-   实时 Level-2

PC 桌面优先，同时适配手机和平板。

------------------------------------------------------------------------

# 2. 技术栈

## 2.1 前端

-   React
-   TypeScript
-   Vite
-   Apache ECharts
-   CSS Modules / Tailwind CSS 二选一
-   尽量轻量，不使用庞大的后台管理模板

ECharts 用于：

-   K 线
-   成交量
-   市场热力图 Treemap
-   行业强弱
-   资金趋势
-   历史评分
-   历史收益

## 2.2 后端

-   Cloudflare Workers
-   TypeScript
-   Cloudflare D1

## 2.3 数据处理

-   Python 3.11+
-   AKShare 为主要免费数据源
-   Pandas / Polars 均可
-   必须实现 DataProvider 抽象

## 2.4 自动任务

-   GitHub Actions
-   `workflow_dispatch` 按需触发
-   可增加每周一次 integrity check 作为兜底

## 2.5 部署

-   GitHub Repository
-   Cloudflare Workers / 静态 Assets
-   Cloudflare D1

所有 Token、Cloudflare 凭据、GitHub Token 必须使用 Secrets。

禁止把任何 Token 提交到 Git。

------------------------------------------------------------------------

# 3. 核心数据更新机制

本项目**不要依赖每天固定时间一定执行一次任务**。

主要模式：

**历史数据初始化一次 + 网站打开检查数据库 + 自动补齐缺失交易日。**

## 3.1 首次初始化

执行：

``` text
initialize.py
    ↓
获取股票列表
    ↓
导入 5~10 年历史日行情
    ↓
导入近 5 年可获取财务数据
    ↓
导入行业/概念信息
    ↓
计算历史指标
    ↓
写入数据库
    ↓
记录 last_complete_trade_date
```

历史资金流如果免费数据源无法稳定回填，不阻塞初始化。

资金数据允许从项目上线日起逐日积累。

## 3.2 日常打开网站

``` text
用户打开网站
    ↓
GET /api/sync/status
    ↓
Worker 查询数据库最新完整交易日
    ↓
计算 target_trade_date
    ↓
是否存在缺失交易日？
    ↓
否 ─────────→ 正常展示
    ↓ 是
获取 sync lock
    ↓
触发 GitHub Actions workflow_dispatch
    ↓
页面继续显示已有数据
    ↓
显示：
“发现 3 个交易日未同步，正在更新”
    ↓
GitHub Actions 执行 Python
    ↓
重新检查数据库缺口
    ↓
逐交易日补齐
    ↓
计算因子
    ↓
计算评分
    ↓
生成每日 Top10
    ↓
生成市场信号
    ↓
更新板块数据
    ↓
写入 D1
    ↓
sync = success
    ↓
前端检测成功
    ↓
自动刷新
```

## 3.3 当日数据判断

中国交易日当天：

-   16:30 Asia/Shanghai 之前：目标日期为上一个完整交易日。
-   16:30 之后：如果当天是交易日，可以尝试同步当天数据。

必须保留配置项：

``` text
MARKET_DATA_READY_TIME=16:30
```

以后可以修改。

## 3.4 多天没有打开

例如数据库最后日期：

``` text
2026-08-20
```

用户到：

``` text
2026-08-26
```

才打开。

系统必须自动识别缺少：

``` text
2026-08-21
2026-08-24
2026-08-25
2026-08-26
```

然后一次任务按顺序补齐。

## 3.5 幂等

重复运行同一天：

-   不允许重复记录。
-   使用 UPSERT。
-   每个交易日必须有完整性状态。
-   某一天失败后，下次可以继续修复。

------------------------------------------------------------------------

# 4. 同步状态与完整性

必须建立同步锁，防止刷新网页重复触发 GitHub Actions。

建议：

``` text
sync_state

status:
idle
pending
running
success
failed

target_date
last_success_date
requested_at
started_at
finished_at
github_run_id
error
```

每天的数据完整性：

``` text
daily_import_status

trade_date
expected_count
actual_count

quote_complete
financial_complete
sector_complete
fund_flow_complete
factor_complete
score_complete
pick_complete
```

不能因为数据库里出现了一部分当天数据就认为当天成功。

------------------------------------------------------------------------

# 5. DataProvider

禁止把 AKShare API 调用散落到业务代码。

实现：

``` python
class StockDataProvider:

    def get_trade_calendar(...):
        pass

    def get_stock_list(...):
        pass

    def get_daily_quotes(...):
        pass

    def get_history(...):
        pass

    def get_daily_basic(...):
        pass

    def get_financials(...):
        pass

    def get_industry_list(...):
        pass

    def get_concept_list(...):
        pass

    def get_sector_members(...):
        pass

    def get_industry_fund_flow(...):
        pass

    def get_concept_fund_flow(...):
        pass

    def get_stock_fund_flow(...):
        pass
```

第一版：

``` text
AkShareProvider
```

预留：

``` text
BaoStockProvider
TushareProvider
FutureProvider
```

接口抓取必须：

-   超时
-   重试
-   限速
-   日志
-   错误恢复

单只股票失败不能导致整个任务无法恢复。

------------------------------------------------------------------------

# 6. 数据库

至少实现以下表。

## stocks

``` text
code
name
market
industry
list_date
is_st
status
updated_at
```

## daily_quotes

``` text
trade_date
code

open
high
low
close

volume
amount
pct_change
turnover_rate

PRIMARY / UNIQUE:
trade_date + code
```

## stock_latest

每只股票只保存最新可筛选状态。

``` text
code
name
trade_date
industry

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

tags_json
updated_at
```

## financial_latest

``` text
code
report_date

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
```

## daily_score

``` text
trade_date
code

valuation
quality
growth
trend
momentum
volume_price
risk

total_score
rank_total
data_completeness
```

## daily_picks

``` text
trade_date
list_type
code
rank
score
reasons_json

return_1d
return_5d
return_20d
return_60d

benchmark_return_5d
benchmark_return_20d
benchmark_return_60d

excess_return_5d
excess_return_20d
excess_return_60d
```

## sector_daily

``` text
trade_date
sector_type
sector_id
name

pct_change
amount

main_net_inflow
main_net_inflow_ratio

up_count
down_count

strength_5d
strength_20d

source
source_definition
```

## sync_state

按前述定义。

## daily_import_status

按前述定义。

------------------------------------------------------------------------

# 7. 因子库 Factor Registry

筛选条件必须配置化。

不要把：

``` javascript
if (pe < 20 && roe > 10)
```

写死在业务页面。

定义：

``` json
{
  "key": "roe",
  "name": "ROE",
  "category": "quality",
  "type": "number",
  "unit": "%",
  "direction": "higher_better",
  "filterable": true,
  "scorable": true,
  "operators": [">", ">=", "<", "<=", "between"]
}
```

以后增加一个指标时：

1.  数据层增加字段/计算。
2.  Factor Registry 增加配置。
3.  通用筛选器自动支持。

------------------------------------------------------------------------

# 8. V1 内置因子

至少实现以下指标。

## 估值

-   PE(TTM)
-   PB
-   PS
-   PEG
-   股息率
-   PE 历史分位
-   PB 历史分位

## 成长

-   营收同比
-   净利润同比
-   扣非净利润同比
-   营收 3 年 CAGR
-   净利润 3 年 CAGR
-   利润增长加速度

## 质量

-   ROE
-   ROA
-   毛利率
-   净利率
-   经营现金流 / 净利润
-   资产负债率

## 趋势

-   Close \> MA20
-   Close \> MA60
-   Close \> MA250
-   MA5 \> MA20
-   MA20 \> MA60
-   MA60 \> MA250
-   MA20 slope
-   MA60 slope
-   多头排列

## 动量

-   5 日收益
-   20 日收益
-   60 日收益
-   120 日收益
-   250 日收益
-   RSI14
-   相对沪深300强度

## 量价

-   今日成交量 / 5日平均成交量
-   今日成交量 / 20日平均成交量
-   5日均量 / 20日均量
-   换手率
-   换手率历史分位
-   成交额

## 位置

-   距 20 日最高点
-   距 60 日最高点
-   距 250 日最高点
-   距 250 日最低点
-   250 日价格分位

## 风险

-   20 日波动率
-   60 日波动率
-   最大回撤
-   Beta
-   ST 标志
-   退市风险

## 市场

-   行业
-   概念
-   总市值
-   流通市值
-   上市天数

------------------------------------------------------------------------

# 9. 自定义选股器

用户可以自由添加条件。

UI 结构：

``` text
[指标] [运算符] [值]

ROE          大于       12%
PE           小于       20
净利润同比   大于       15%
量比20       大于       1.5
20日涨幅     小于       15%

+ 添加条件
```

请求结构：

``` json
{
  "logic": "AND",
  "rules": [
    {
      "field": "pe_ttm",
      "op": "between",
      "value": [0, 20]
    },
    {
      "field": "roe",
      "op": ">=",
      "value": 12
    },
    {
      "field": "profit_yoy",
      "op": ">=",
      "value": 15
    },
    {
      "field": "volume_ratio_20",
      "op": ">=",
      "value": 1.5
    }
  ],
  "sort": [
    {
      "field": "score_total",
      "direction": "desc"
    }
  ],
  "limit": 100
}
```

支持：

``` text
>
>=
<
<=
=
!=
between
in
not_in
```

Worker：

-   使用字段白名单。
-   使用参数化 SQL。
-   禁止前端提交任意 SQL。

个人自用，用户自己的筛选模板第一版可以保存：

``` text
localStorage
```

内置模板保存到配置文件或数据库。

------------------------------------------------------------------------

# 10. 多因子评分

每日对全市场计算七个维度。

默认权重：

``` text
质量 Quality          20%
成长 Growth           20%
趋势 Trend            20%
估值 Valuation        15%
动量 Momentum         10%
量价 Volume/Price     10%
风险 Risk              5%
```

优先使用当天全市场横截面 Percentile Rank。

例如：

某股票 ROE 超过全市场 92% 股票：

``` text
ROE factor score = 92
```

对于：

``` text
higher_better
```

使用 percentile。

对于：

``` text
lower_better
```

使用：

``` text
100 - percentile
```

缺失数据不能简单算 0 分。

必须：

-   对有效因子权重重新归一化。
-   记录 `data_completeness`。
-   数据完整度过低时不能进入每日精选。

综合分：

``` text
score_total =
quality * 0.20
+ growth * 0.20
+ trend * 0.20
+ valuation * 0.15
+ momentum * 0.10
+ volume_price * 0.10
+ risk * 0.05
```

所有权重必须配置化。

------------------------------------------------------------------------

# 11. 每日精选

每日评分后自动生成：

``` text
综合精选 Top10
低估成长 Top10
趋势增强 Top10
放量突破 Top10
超跌修复 Top10
```

不要单纯选择综合分最高的股票。

先做硬过滤，例如：

``` text
非 ST
非退市整理
上市 > 250 交易日
非长期停牌
成交额 > 配置阈值
数据完整度 > 配置阈值
```

每个候选必须生成 3\~5 个结构化理由。

例如：

``` text
ROE 全市场前 8%
净利润同比 +31%
20日量比 1.82
MA20 > MA60 且两者向上
PE 位于自身历史 23% 分位
```

Reasons 必须来自真实计算结果。

不要调用 AI 编造理由。

------------------------------------------------------------------------

# 12. 内置市场信号

实现：

-   放量上涨
-   放量下跌
-   缩量上涨
-   缩量回调
-   突破 20 日新高
-   突破 60 日新高
-   突破 250 日新高
-   跌破 MA20
-   跌破 MA60
-   MA5 上穿 MA20
-   MA20 \> MA60
-   MA60 \> MA250
-   多头排列
-   连续上涨
-   连续缩量
-   底部放量
-   超跌修复
-   低估值高 ROE
-   低估值成长
-   利润加速

所有信号由明确规则生成。

点击信号：

``` text
放量下跌 83只
```

进入对应股票列表。

------------------------------------------------------------------------

# 13. 首页 Dashboard

首页不是新闻门户。

布局顺序如下。

## 13.1 顶部

显示：

``` text
A股 Quant Dashboard

数据日期：2026-08-26
最后同步：16:42

[数据已最新]
[检查更新]
[股票搜索]
```

如果正在补：

``` text
数据：2026-08-25
发现 1 个交易日未同步
正在更新...
```

旧数据继续正常展示。

## 13.2 市场概览

显示：

-   上证指数
-   深证成指
-   创业板
-   沪深300
-   上涨家数
-   下跌家数
-   涨停数量
-   跌停数量
-   全市场成交额
-   与上一交易日成交额变化

## 13.3 A 股热力图

使用 ECharts Treemap。

默认：

``` text
面积 = 流通市值
颜色 = 当日涨跌幅
```

支持：

``` text
面积：
流通市值
成交额

分组：
全市场
行业
```

A 股习惯：

``` text
上涨 = 红
下跌 = 绿
```

hover：

``` text
股票名称
代码
涨跌幅
价格
成交额
流通市值
行业
综合评分
```

点击进入个股详情。

## 13.4 板块强弱

两个 Tab：

``` text
行业
概念
```

字段：

``` text
板块名称
今日涨跌
成交额
主力净流入
主力净流入占比
上涨家数
下跌家数
5日强度
20日强度
```

支持排序：

``` text
涨幅
资金净流入
成交额
上涨比例
5日强度
20日强度
```

资金流 UI 必须标注：

``` text
数据源口径
```

不能描述成交易所官方机构真实资金。

## 13.5 今日精选

展示 Top10。

每只：

``` text
01 股票名称   88.6

质量 91
成长 86
趋势 94
估值 71
动量 82
量价 93
风险 78

↑ ROE 全市场前 8%
↑ 20日量比 1.82
↑ MA20 / MA60 向上
↓ 当前估值不属于最低区间
```

可切换：

``` text
综合
低估成长
趋势增强
放量突破
超跌修复
```

## 13.6 市场信号

例如：

``` text
放量上涨        126
放量下跌         83
突破60日新高      71
突破250日新高     32
跌破MA60          96
多头排列         314
连续缩量         182
超跌             108
```

点击查看股票。

## 13.7 昨日精选表现

显示：

``` text
昨日 Top10

上涨：7 / 10
平均收益：+1.26%
沪深300：+0.43%
超额：+0.83%
```

同时提供：

``` text
过去20个交易日样本

平均1日收益
平均5日收益
平均20日收益
平均60日收益

胜率
相对沪深300超额收益
```

------------------------------------------------------------------------

# 14. 页面

实现以下路由：

``` text
/
今日市场 Dashboard

/picks
每日精选

/screener
自定义选股

/sectors
板块分析

/signals
市场信号

/stock/:code
个股详情

/settings
设置 / 数据状态
```

------------------------------------------------------------------------

# 15. 个股详情

顶部：

``` text
600519 贵州茅台

价格
涨跌
行业
综合评分
市场排名
```

## K线

-   日K
-   成交量
-   MA5
-   MA20
-   MA60
-   MA250

## 七维评分

使用横向评分条。

不要只使用雷达图。

显示：

``` text
综合       82.6

质量       94
成长       72
估值       68
趋势       87
动量       81
量价       76
风险       89
```

## 为什么获得这个评分

分别展示：

``` text
正面因素
负面因素
```

例如：

``` text
+ ROE 全市场前 7%
+ MA20 / MA60 向上
+ 60日相对强度较高

- PE 位于自身5年 63% 分位
- 当前量能一般
```

## 估值

-   PE
-   PB
-   PS
-   股息率
-   历史估值分位

## 财务

-   营收
-   营收同比
-   净利润
-   净利润同比
-   ROE
-   毛利率
-   现金流
-   负债率

## 趋势 / 量价

-   MA
-   收益
-   量比
-   换手率
-   位置
-   波动率
-   最大回撤

## 板块

显示：

-   所属行业
-   所属概念
-   板块今日强度
-   板块资金

## 历史评分

显示评分曲线。

显示历史进入：

``` text
Top10
趋势增强
低估成长
放量突破
```

的日期。

------------------------------------------------------------------------

# 16. 板块分析

行业和概念分别展示。

板块详情：

``` text
板块名称

今日涨跌
5日涨跌
20日涨跌

成交额
主力净流入
主力净流入占比

上涨 / 下跌数量
```

下面展示：

``` text
板块资金趋势
板块强度趋势
板块成分股
成分股评分排行
```

------------------------------------------------------------------------

# 17. 精选历史验证

这是核心功能，不能省略。

每天保存当时的候选结果，不能以后重新计算覆盖历史候选。

未来交易日到达后，自动补：

``` text
return_1d
return_5d
return_20d
return_60d
```

以及：

``` text
benchmark_return
excess_return
```

基准默认：

``` text
沪深300
```

还可以计算：

``` text
MFE
最大有利波动

MAE
最大不利波动
```

Dashboard 展示历史统计。

这是历史验证，不是未来预测。

------------------------------------------------------------------------

# 18. 网站视觉风格

网站是个人金融工作台。

设计方向：

**Dark Financial Terminal + Linear 风格**

不要模仿传统东方财富/同花顺的拥挤门户。

## 色彩

``` text
Background        #0B0F14
Surface           #111820
Surface Hover     #151D26
Border            #1E2933

Primary Text      #E6EDF3
Secondary Text    #8B949E

Accent            蓝 / 青色系

A股上涨           红
A股下跌           绿
```

## 布局

-   12-column Dashboard Grid
-   桌面端充分利用 1440px 横向空间
-   卡片圆角 8\~12px
-   极少阴影
-   使用细边框和背景层级
-   数据密度高但不拥挤
-   表格紧凑
-   数字使用 `tabular-nums`
-   hover 显示更多细节

## 禁止

不要：

-   大面积渐变
-   玻璃拟态
-   巨型 Hero
-   营销 Banner
-   AI 机器人插画
-   新闻瀑布流
-   夸张动画
-   大面积无意义留白
-   传统后台模板风格

动画仅用于：

-   hover
-   数据刷新
-   图表过渡
-   loading

------------------------------------------------------------------------

# 19. API

至少实现：

``` text
GET  /api/sync/status
POST /api/sync/check

GET  /api/market/overview?date=
GET  /api/market/heatmap?date=&group=&sizeBy=

GET  /api/sectors?date=&type=industry|concept&sort=
GET  /api/sectors/:id

GET  /api/picks?date=&type=

POST /api/screener

GET  /api/signals?date=
GET  /api/signals/:key?date=

GET  /api/stocks/search?q=
GET  /api/stocks/:code
GET  /api/stocks/:code/history?range=
GET  /api/stocks/:code/scores

GET  /api/performance/picks?window=1|5|20|60
```

------------------------------------------------------------------------

# 20. 项目目录

建议：

``` text
/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── charts/
│   │   ├── api/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
│
├── worker/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db/
│   │   └── security/
│   └── wrangler.toml
│
├── scripts/
│   ├── providers/
│   │   ├── base.py
│   │   └── akshare_provider.py
│   ├── initialize.py
│   ├── sync_missing.py
│   ├── calculate_factors.py
│   ├── calculate_scores.py
│   ├── generate_picks.py
│   ├── calculate_performance.py
│   └── validate_import.py
│
├── config/
│   ├── factors.json
│   ├── score_weights.json
│   ├── strategies.json
│   ├── signals.json
│   └── app.json
│
├── migrations/
│
├── tests/
│
├── .github/
│   └── workflows/
│       ├── sync_on_demand.yml
│       └── weekly_integrity_check.yml
│
├── .env.example
├── README.md
└── package.json
```

------------------------------------------------------------------------

# 21. GitHub Actions

## sync_on_demand.yml

必须支持：

``` text
workflow_dispatch
```

Action 启动后不要完全相信 Worker 传来的日期。

必须自己查询：

``` text
last_complete_trade_date
```

重新计算真正缺失交易日。

然后逐日补齐。

## weekly_integrity_check.yml

每周运行一次。

作用：

``` text
检查最近数据完整性
检查有没有遗漏交易日
检查 daily_import_status
发现缺失则自动修复
```

------------------------------------------------------------------------

# 22. 安全

GitHub Token 只能存在：

``` text
Cloudflare Worker Secret
```

禁止放：

``` text
React
JavaScript bundle
Git repository
wrangler.toml 明文
```

Worker 触发同步 API 应增加简单鉴权/防滥用措施。

即使网站个人使用，也不要让公开访问者无限触发 GitHub Actions。

------------------------------------------------------------------------

# 23. 性能

目标：

-   首页已有数据情况下快速展示。
-   同步任务不阻塞页面。
-   Heatmap 不要一次传输不需要的大字段。
-   Screener 查询只 SELECT 所需字段。
-   stock_latest 建立常用索引。
-   API 支持合理缓存。
-   ECharts 数据转换使用 memoization。
-   股票列表 5000+ 条时仍然可以流畅筛选和排序。

------------------------------------------------------------------------

# 24. 设置页面

个人自用，因此允许修改：

``` text
评分权重

质量
成长
趋势
估值
动量
量价
风险
```

以及：

``` text
是否排除 ST
最低上市天数
最低成交额
最低数据完整度
Top 数量
市场数据完成时间
```

设置第一版可以 localStorage。

涉及服务器计算的评分配置，则通过配置文件统一管理。

------------------------------------------------------------------------

# 25. 明确禁止

禁止：

-   Mock 数据作为最终实现
-   自动交易
-   自动下单
-   将综合分称为"上涨概率"
-   AI 编造选股理由
-   AKShare 调用散落在业务代码
-   Token 放到前端
-   缺失数据时假装是最新数据
-   为视觉效果牺牲数据密度
-   用一个巨大组件实现整个 Dashboard
-   将所有指标逻辑硬编码到 UI
-   每次启动重新抓取完整历史

------------------------------------------------------------------------

# 26. 开发阶段

不要一次生成大量未经验证的代码。

## Phase 1

建立：

-   Repository structure
-   React
-   Worker
-   D1 migrations
-   基础 API
-   路由
-   构建系统

要求构建成功。

## Phase 2

实现：

-   DataProvider
-   AKShareProvider
-   股票列表
-   日行情
-   初始化
-   缺失数据补齐
-   完整性校验

用真实少量股票验证。

## Phase 3

实现：

-   Factor Registry
-   指标计算
-   七维评分
-   综合评分
-   Top10
-   单元测试

## Phase 4

实现：

-   自定义 Screener
-   Worker 参数化 SQL
-   筛选 UI
-   保存筛选条件

## Phase 5

实现：

-   Dashboard
-   市场概览
-   Heatmap
-   板块
-   资金
-   市场信号
-   每日精选

## Phase 6

实现：

-   个股详情
-   K线
-   财务
-   估值
-   历史评分

## Phase 7

实现：

-   Worker 检测缺失
-   sync lock
-   GitHub Actions trigger
-   前端同步状态
-   自动刷新

## Phase 8

实现：

-   历史候选表现
-   benchmark
-   1/5/20/60日验证
-   设置
-   错误状态
-   Responsive UI

## Phase 9

完成：

-   Cloudflare 部署
-   D1 初始化
-   Secrets 文档
-   GitHub Actions 配置
-   README
-   故障恢复说明

------------------------------------------------------------------------

# 27. 验收标准

最终项目必须满足：

1.  Clone 仓库后按照 README 可以本地运行。
2.  前端和 Worker 均可构建。
3.  D1 migration 可以执行。
4.  可以使用真实免费数据初始化历史数据。
5.  可以计算真实技术指标。
6.  可以计算七维评分。
7.  可以生成每日 Top10。
8.  可以自由添加组合筛选条件。
9.  首页有真实市场热力图。
10. 有行业/概念板块。
11. 有板块资金数据。
12. 有个股详情。
13. 有历史评分。
14. 有每日精选历史表现。
15. 数据库落后多个交易日时，打开网站可以检测缺失。
16. 不会因为页面多次刷新重复启动多个同步任务。
17. GitHub Actions 能补齐缺失交易日。
18. 补齐完成后页面自动更新。
19. 页面明确显示数据日期。
20. 免费数据源某个接口失败时有日志和可恢复机制。

------------------------------------------------------------------------

# 28. 开始执行

完整阅读本文档后：

1.  先检查当前目录是否已经存在项目。
2.  如果是空目录，创建上述项目结构。
3.  如果已经存在代码，先分析现状，不要无脑覆盖。
4.  输出一个简短实施计划和目录树。
5.  然后立即开始 Phase 1。
6.  每个 Phase 完成后实际运行 build/test。
7.  发现错误必须修复后再继续。
8.  除非确实需要用户提供 GitHub / Cloudflare
    凭据，否则不要中途停下来反复询问。
9.  缺少凭据时，先完成所有不依赖凭据的实现，并生成 `.env.example`
    和配置说明。
10. 最终给出完整部署步骤、D1
    初始化步骤、首次历史数据导入方法和日常自动补齐工作流说明。

**目标不是生成一个演示页面，而是生成一个能够长期自己使用、数据可以持续积累、指标可以持续扩展的
A 股量化分析工具。**
