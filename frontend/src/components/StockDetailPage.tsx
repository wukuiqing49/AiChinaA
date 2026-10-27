import { useState } from "react";
import type { ScreenerItem,User } from "../api";
import { formatNumber,formatRatioPercent,marketDate } from "../formatters";

export default function StockDetailPage({
  stock,
  user,
  theme,
  isFullScreen,
  isWatchlisted,
  onAdd,
  onToggleFullScreen,
  onClose,
}: {
  stock: ScreenerItem;
  user: User | null;
  theme: "light" | "dark";
  isFullScreen: boolean;
  isWatchlisted: boolean;
  onAdd: (code: string) => Promise<void>;
  onToggleFullScreen: () => void;
  onClose: () => void;
}) {
  const [chartInterval, setChartInterval] = useState<"D" | "W" | "60" | "15">("D");
  const [activeDetailTab, setActiveDetailTab] = useState<"chart" | "quant" | "f10">("chart");

  const isSh = stock.code.startsWith("6") || stock.code.startsWith("5");
  const marketPrefix = stock.market === "BJ" ? "BJ" : isSh ? "SH" : "SZ";
  const tvSymbol = stock.market === "BJ" ? `BSE:${stock.code}` : isSh ? `SSE:${stock.code}` : `SZSE:${stock.code}`;

  const eastmoneyUrl = `https://quote.eastmoney.com/${marketPrefix.toLowerCase()}${stock.code}.html`;
  const xueqiuUrl = `https://xueqiu.com/S/${marketPrefix}${stock.code}`;
  const fundFlowUrl = `https://data.eastmoney.com/zjlx/${stock.code}.html`;
  const thsUrl = `https://stockpage.10jqka.com.cn/${stock.code}/`;
  const sinaUrl = `https://finance.sina.com.cn/realstock/company/${marketPrefix.toLowerCase()}${stock.code}/nc.shtml`;

  const trendDesc =
    stock.ma20Slope !== null && stock.ma20Slope > 0.02
      ? "20日均线呈强劲向上发散形态，处于多头上升趋势。"
      : stock.ma20Slope !== null && stock.ma20Slope < -0.02
      ? "20日均线呈向下开口形态，处于空头调整波段。"
      : "20日均线走平，处于区间震荡整理阶段。";

  const momentumDesc =
    stock.ret20d !== null && stock.ret20d > 0.1
      ? "近20个交易日累计上涨超过10%。"
      : stock.ret20d !== null && stock.ret20d < -0.1
      ? "近20日跌幅较大，短线超跌或处于弱势动量区。"
      : "近20日动量适中，跟随大盘平稳波动。";

  const volumeDesc =
    stock.volumeRatio20 !== null && stock.volumeRatio20 > 1.3
      ? "量比明显放大，主力资金介入与换手活跃度高。"
      : stock.volumeRatio20 !== null && stock.volumeRatio20 < 0.8
      ? "缩量成交，市场交投相对清淡。"
      : "成交量维持在正常滚动均量水平。";

  const riskDesc =
    stock.volatility20 !== null && stock.volatility20 < 0.25
      ? "年化波动率较低，属于低波动稳健型标的。"
      : "年化波动率较高，属于弹性较大博弈型标的。";

  const tvTheme = theme === "dark" ? "dark" : "light";

  return (
    <div className={`detail-page-backdrop ${isFullScreen ? "fullscreen" : "drawer"}`} onClick={onClose}>
      <article className="detail-container" onClick={(e) => e.stopPropagation()}>
        {/* Top Navigation Bar */}
        <header className="detail-header">
          <div className="stock-title-wrap">
            <h2>
              {stock.name} <span className="code-tag">{stock.code}</span>
            </h2>
            <div className="stock-tags">
              <span className="tag market-tag">{stock.market === "SH" ? "上海证券交易所" : "深圳证券交易所"}</span>
              <span className="tag industry-tag">{stock.industry || "主板 / ETF 标的"}</span>
              <span className="tag date-tag">基准日: {stock.tradeDate}</span>
              {stock.quoteDate && (
                <span className="tag date-tag">行情日: {marketDate(stock)}{stock.quoteTime ? ` ${stock.quoteTime}` : ""}</span>
              )}
            </div>
          </div>
          <div className="header-controls">
            <button className="icon-btn" onClick={onToggleFullScreen} title={isFullScreen ? "还原窗口" : "全屏详情页"}>
              {isFullScreen ? "🗗 窗口" : "⛶ 全屏"}
            </button>
            <button className="icon-btn close-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </header>

        {/* Highlight Price & Score Bar */}
        <section className="key-metrics-banner">
          <div className="metric-cell">
            <span className="metric-label">最新收盘价</span>
            <span className="metric-num price-val">¥ {formatNumber(stock.close)}</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">20日收益率</span>
            <span className={`metric-num ${stock.ret20d !== null && stock.ret20d < 0 ? "negative" : "positive"}`}>
              {formatRatioPercent(stock.ret20d)}
            </span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">换手率</span>
            <span className="metric-num">{formatNumber(stock.turnoverRate)}%</span>
          </div>
          <div className="metric-cell">
            <span className="metric-label">20日年化波动率</span>
            <span className="metric-num">{(stock.volatility20 === null ? "-" : `${(stock.volatility20 * 100).toFixed(2)}%`)}</span>
          </div>
          <div className="metric-cell score-cell">
            <span className="metric-label">量化综合评分</span>
            <span className="metric-num score-val">{formatNumber(stock.score, 1)} <span className="score-unit">分</span></span>
          </div>
        </section>

        {/* View Switcher Tabs */}
        <nav className="detail-view-tabs">
          <button
            className={activeDetailTab === "chart" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("chart")}
          >
            📈 交互式专业 K 线图
          </button>
          <button
            className={activeDetailTab === "quant" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("quant")}
          >
            🎯 量化多因子与智能诊断
          </button>
          <button
            className={activeDetailTab === "f10" ? "view-tab active" : "view-tab"}
            onClick={() => setActiveDetailTab("f10")}
          >
            📑 全网 F10 与资金流直达
          </button>
        </nav>

        {/* Tab 1: Interactive K-Line Chart */}
        {activeDetailTab === "chart" && (
          <section className="chart-view-section">
            <div className="chart-toolbar">
              <span className="toolbar-label">周期选择：</span>
              <div className="interval-buttons">
                <button
                  className={chartInterval === "D" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("D")}
                >
                  日 K
                </button>
                <button
                  className={chartInterval === "W" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("W")}
                >
                  周 K
                </button>
                <button
                  className={chartInterval === "60" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("60")}
                >
                  60 分钟
                </button>
                <button
                  className={chartInterval === "15" ? "interval-btn active" : "interval-btn"}
                  onClick={() => setChartInterval("15")}
                >
                  15 分钟
                </button>
              </div>
              <span className="chart-source-tip">第三方图表可能延迟；行情时间以页面标注为准。</span>
            </div>
            <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`} target="_blank" rel="noreferrer">图表无法加载时，在 TradingView 打开 ↗</a>
            <div className="main-chart-frame">
              <iframe
                title="TradingView Realtime Chart"
                src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${tvSymbol}&interval=${chartInterval}&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=${theme === "dark" ? "1e293b" : "f1f3f6"}&theme=${tvTheme}&style=1&timezone=Asia%2FShanghai&locale=zh_CN`}
                className="full-tv-iframe"
              />
            </div>
          </section>
        )}

        {/* Tab 2: Quant Factor Diagnostics */}
        {activeDetailTab === "quant" && (
          <section className="quant-view-section">
            <h3>多维度因子明细与智能诊断</h3>
            <div className="diagnostic-cards">
              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">📈</span>
                  <strong>趋势维度 (Trend)</strong>
                  <span className="diag-val">{formatRatioPercent(stock.ma20Slope)}</span>
                </div>
                <p className="diag-text">{trendDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">⚡</span>
                  <strong>动量维度 (Momentum)</strong>
                  <span className="diag-val">{formatRatioPercent(stock.ret20d)}</span>
                </div>
                <p className="diag-text">{momentumDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">📊</span>
                  <strong>量价活跃度 (Volume-Price)</strong>
                  <span className="diag-val">{formatNumber(stock.volumeRatio20)}</span>
                </div>
                <p className="diag-text">{volumeDesc}</p>
              </div>

              <div className="diag-card">
                <div className="diag-card-header">
                  <span className="diag-icon">🛡️</span>
                  <strong>风险与波动 (Risk)</strong>
                  <span className="diag-val">{(stock.volatility20 === null ? "-" : `${(stock.volatility20 * 100).toFixed(2)}%`)}</span>
                </div>
                <p className="diag-text">{riskDesc}</p>
              </div>
            </div>

            <div className="factors-table-wrap">
              <h4>技术评分拆解</h4>
              <div className="factor-grid-full">
                <div className="factor-pill">
                  <span>趋势评分</span>
                  <strong className="score-val">{formatNumber(stock.scoreTrend, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>动量评分</span>
                  <strong className="score-val">{formatNumber(stock.scoreMomentum, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>量价评分</span>
                  <strong className="score-val">{formatNumber(stock.scoreVolumePrice, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>风险评分</span>
                  <strong className="score-val">{formatNumber(stock.scoreRisk, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>技术综合评分</span>
                  <strong className="score-val">{formatNumber(stock.score, 1)}</strong>
                </div>
                <div className="factor-pill">
                  <span>评分数据完整度</span>
                  <strong>{stock.dataCompleteness ? `${(stock.dataCompleteness * 100).toFixed(0)}%` : "-"}</strong>
                </div>
              </div>
            </div>

            <div className="factors-table-wrap">
              <h4>技术指标清单</h4>
              <div className="factor-grid-full">
                <div className="factor-pill">
                  <span>5日累计收益</span>
                  <strong>{formatRatioPercent(stock.ret5d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日累计收益</span>
                  <strong>{formatRatioPercent(stock.ret20d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>60日累计收益</span>
                  <strong>{formatRatioPercent(stock.ret60d)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日均线斜率</span>
                  <strong>{formatRatioPercent(stock.ma20Slope)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日平均量比</span>
                  <strong>{formatNumber(stock.volumeRatio20)}</strong>
                </div>
                <div className="factor-pill">
                  <span>20日年化波动率</span>
                  <strong>{(stock.volatility20 === null ? "-" : `${(stock.volatility20 * 100).toFixed(2)}%`)}</strong>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: External Research Links */}
        {activeDetailTab === "f10" && (
          <section className="research-view-section">
            <h3>全网权威资料一键深度调研</h3>
            <p className="research-sub">
              结合各大主流专业金融机构的 F10、财务报表、资金流向及社区研报：
            </p>
            <div className="deep-research-links-grid">
              <a href={eastmoneyUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">📊</div>
                <div className="portal-info">
                  <strong>东方财富 F10 深度资料</strong>
                  <span>查看资产负债表、利润表、分红派息、高管持股与十大股东</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={fundFlowUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">💰</div>
                <div className="portal-info">
                  <strong>东方财富主力资金流向</strong>
                  <span>查看当日与近期超大单、大单、中单、散户净流入占比</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={xueqiuUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">💬</div>
                <div className="portal-info">
                  <strong>雪球个股讨论与机构研报</strong>
                  <span>汇聚买方/卖方深度研报、大V深度逻辑剖析与实时互动</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={thsUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">📈</div>
                <div className="portal-info">
                  <strong>同花顺筹码分布与股东分析</strong>
                  <span>查看获利盘比例、股东户数增减、机构持仓变动与龙虎榜</span>
                </div>
                <span className="arrow">↗</span>
              </a>

              <a href={sinaUrl} target="_blank" rel="noreferrer" className="portal-card">
                <div className="portal-icon">⚡</div>
                <div className="portal-info">
                  <strong>新浪财经实时买卖五档</strong>
                  <span>即时 Level-1 盘口买卖队列与实时分笔明细</span>
                </div>
                <span className="arrow">↗</span>
              </a>
            </div>
          </section>
        )}

        {/* Footer Action Bar */}
        <footer className="detail-footer">
          <div className="footer-left">
            <span className="tip">💡 提示：按 ESC 键或点击右上角 ✕ 即可返回</span>
          </div>
          <div className="footer-right">
            <button
              className={isWatchlisted ? "secondary-button" : "primary-button"}
              onClick={() => void onAdd(stock.code)}
            >
              {isWatchlisted ? "★ 已在自选池中" : user ? "+ 加入自选池" : "登录后加入自选"}
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
}
