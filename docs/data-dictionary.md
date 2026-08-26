# 数据字典（Phase 0 草案）

| 字段 | 类型 | 单位/格式 | 空值语义 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string | 六位证券代码 | 不允许 | 保留前导零 |
| `trade_date` | string | `YYYY-MM-DD` | 不允许 | 由交易日历验证 |
| `open/high/low/close` | number | 人民币元 | 不允许 | K 线使用不复权价格 |
| `volume` | number | 股 | `null` 表示来源不可用 | 不使用 0 替代缺失 |
| `amount` | number | 人民币元 | `null` 表示来源不可用 | 成交额 |
| `pct_change` | number | 百分比 | `null` 表示来源不可用 | 必须保留来源口径 |
| `turnover_rate` | number | 百分比 | `null` 表示来源不可用 | 换手率 |
| `announce_date` | string | `YYYY-MM-DD` | `null` 表示不可用于历史财务评分 | 财务公告/披露日 |
| `data_completeness` | number | 0–1 | 不允许 | 有效评分权重占比 |

## 价格与收益

- K 线显示不复权 OHLC。
- 技术指标使用单一、版本化复权序列；实施前必须在 Provider 报告中记录来源。
- 默认表现口径为信号后下一交易日开盘至第 N 个交易日收盘。
- 停牌、不可成交和未来窗口未完成必须使用状态字段，不写成 0 收益。
