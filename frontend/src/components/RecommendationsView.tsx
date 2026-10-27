import { useMemo } from "react";
import type { ScreenerItem,User,WatchlistItem,Recommendation } from "../api";
import { formatNumber,formatPercent } from "../formatters";

export default function RecommendationsView({
  recommendations,
  screenerItems,
  user,
  watchlist,
  onAdd,
  onSelectStock,
}: {
  recommendations: Recommendation[];
  screenerItems: ScreenerItem[];
  user: User | null;
  watchlist: WatchlistItem[];
  onAdd: (code: string) => Promise<void>;
  onSelectStock: (item: ScreenerItem) => void;
}) {
  const displayItems = useMemo(() => {
    if (recommendations.length > 0) {
      return recommendations.map((r) => ({
        code: r.code,
        name: r.name,
        rank: r.rank,
        score: r.score,
        referenceClose: r.referenceClose,
        referenceDate: r.referenceTradeDate,
        latestClose: r.latestClose,
        returnPct: r.tracking.returnPct,
        screenerItem: screenerItems.find((s) => s.code === r.code) || {
          code: r.code,
          name: r.name,
          instrumentType: r.code.startsWith("5") || r.code.startsWith("1") ? "etf" : "stock",
          isSt: false,
          tradeDate: r.latestTradeDate,
          quoteDate: null,
          quoteTime: null,
          quoteSource: null,
          close: r.latestClose,
          score: r.score,
          scoreTrend: null,
          scoreMomentum: null,
          scoreVolumePrice: null,
          scoreRisk: null,
          dataCompleteness: 1,
          market: r.code.startsWith("6") ? "SH" : "SZ",
          industry: "推荐标的",
          pctChange: null,
          turnoverRate: null,
          ret5d: null,
          ret20d: null,
          ret60d: null,
          ma20Slope: null,
          volumeRatio20: null,
          volatility20: null,
        },
      }));
    }

    const top = [...screenerItems].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
    return top.map((s, idx) => ({
      code: s.code,
      name: s.name,
      rank: idx + 1,
      score: s.score ?? 0,
      referenceClose: null,
      referenceDate: s.tradeDate,
      latestClose: s.close,
      returnPct: null,
      screenerItem: s,
    }));
  }, [recommendations, screenerItems]);

  return (
    <section className="view-container recommendations-view">
      <div className="section-heading">
        <div>
          <h2>🏆 每日量化精选 Top 10 推荐池</h2>
          <span>按技术评分筛选候选标的；仅有已保存基准的记录展示价格跟踪收益。</span>
        </div>
      </div>

      <div className="recommendations-grid">
        {displayItems.map((rec) => {
          const isWatch = watchlist.some((w) => w.code === rec.code);
          return (
            <div
              key={rec.code}
              className="rec-card clickable-row"
              onClick={() => onSelectStock(rec.screenerItem)}
            >
              <div className="rec-badge-wrap">
                <span className={`rank-badge rank-${rec.rank <= 3 ? rec.rank : "normal"}`}>
                  Top {rec.rank}
                </span>
                <span className="rec-score-pill">得分: {formatNumber(rec.score, 1)}</span>
              </div>

              <div className="rec-stock-title">
                <h3>{rec.name}</h3>
                <span className="rec-code">{rec.code}</span>
              </div>

              <div className="rec-data-grid">
                <div className="rec-data-cell">
                  <span className="label">推荐基准价</span>
                  <span className="val">¥ {formatNumber(rec.referenceClose)}</span>
                </div>
                <div className="rec-data-cell">
                  <span className="label">最新价</span>
                  <span className="val">¥ {formatNumber(rec.latestClose)}</span>
                </div>
                <div className="rec-data-cell">
                  <span className="label">跟踪收益率</span>
                  <span className={`val ${rec.returnPct !== null && rec.returnPct < 0 ? "negative" : "positive"}`}>
                    {formatPercent(rec.returnPct)}
                  </span>
                </div>
              </div>

              <div className="rec-reasons">
                <span className="reason-tag">技术评分候选</span>
                <span className="reason-tag">因子日期：{rec.screenerItem.tradeDate}</span>
              </div>

              <div className="rec-card-footer" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`small-button ${isWatch ? "secondary-button" : "primary-button"}`}
                  onClick={() => void onAdd(rec.code)}
                >
                  {isWatch ? "★ 已在自选" : user ? "+ 加自选" : "登录自选"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** ------------------- CUSTOM RULE SCREENER COMPONENT ------------------- */
