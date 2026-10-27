import type { ScreenerItem,MarketIndexItem } from "./api";

export function formatNumber(value: number | null, digits = 2): string {
  return value === null ? "-" : value.toFixed(digits);
}

export function formatPercent(value: number | null): string {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatRatioPercent(value: number | null): string {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function marketDate(item: Pick<ScreenerItem | MarketIndexItem, "quoteDate" | "tradeDate">): string {
  return item.quoteDate ?? item.tradeDate;
}

