# 因子公式（Phase 0 草案）

本文件在 Phase 0 探针确认字段与单位后冻结。所有因子都必须声明输入、方向、最小样本、空值规则和版本。

| 因子 | 输入 | 方向 | 空值规则 |
| --- | --- | --- | --- |
| `ret_20d` | 20 个交易日复权收盘价 | higher_better | 窗口不足则 unavailable |
| `ma20_slope` | 20 日均线 | higher_better | 窗口不足则 unavailable |
| `volume_ratio_20` | 当日量 / 20 日平均量 | neutral_by_strategy | 均量为 0 或缺失则 unavailable |
| `volatility_20` | 20 日收益标准差年化 | lower_better | 窗口不足则 unavailable |
| `max_drawdown_60` | 60 日滚动最大回撤 | lower_better | 窗口不足则 unavailable |
| `roe` | 最近已公告财务报告 | higher_better | 无公告日时历史评分 unavailable |
| `pe_ttm` | 日估值 | lower_better | 负值和缺失值不参与估值得分 |

所有 percentile 使用同一 tie 方法；缺失因子按有效权重重新归一化，不记为 0 分。
