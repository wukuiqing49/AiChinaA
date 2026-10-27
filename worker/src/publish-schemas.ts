import { z } from "zod";

export const screenerPublishSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9._-]{8,80}$/),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runKind: z.enum(["full_market", "supplemental_st", "single_stock"]).default("full_market"),
  stocks: z.array(z.object({
    code: z.string().regex(/^\d{6}$/),
    name: z.string().min(1).max(80),
    instrumentType: z.enum(["stock", "etf"]),
    isSt: z.boolean(),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).nullable(),
    quoteSource: z.enum(["tencent", "sina"]).nullable(),
    close: z.number().positive().nullable(),
    scoreTotal: z.number().min(0).max(100).nullable(),
    scoreTrend: z.number().min(0).max(100).nullable().default(null),
    scoreMomentum: z.number().min(0).max(100).nullable().default(null),
    scoreVolumePrice: z.number().min(0).max(100).nullable().default(null),
    scoreRisk: z.number().min(0).max(100).nullable().default(null),
    dataCompleteness: z.number().min(0).max(1).nullable(),
    market: z.string().max(8).nullable(),
    industry: z.string().max(80).nullable(),
    pctChange: z.number().nullable(),
    turnoverRate: z.number().min(0).nullable(),
    ret5d: z.number().nullable(),
    ret20d: z.number().nullable(),
    ret60d: z.number().nullable(),
    ma20Slope: z.number().nullable(),
    volumeRatio20: z.number().min(0).nullable(),
    volatility20: z.number().min(0).nullable(),
    volumeRatio5: z.number().min(0).nullable().default(null),
    amount: z.number().min(0).nullable().default(null),
    amountRatio5: z.number().min(0).nullable().default(null),
    amountRatio20: z.number().min(0).nullable().default(null),
    rsi14: z.number().min(0).max(100).nullable().default(null),
    ret120d: z.number().nullable().default(null),
    ret250d: z.number().nullable().default(null),
    distanceHigh20: z.number().nullable().default(null),
    distanceHigh60: z.number().nullable().default(null),
    distanceHigh250: z.number().nullable().default(null),
    distanceLow250: z.number().nullable().default(null),
    pricePercentile250: z.number().min(0).max(1).nullable().default(null),
    volatility60: z.number().min(0).nullable().default(null),
    maxDrawdown60: z.number().nullable().default(null),
  })).min(1).max(6000),
  indices: z.array(z.object({
    code: z.string().min(6).max(12),
    name: z.string().min(1).max(80),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).nullable(),
    quoteSource: z.enum(["tencent", "sina"]).nullable(),
    close: z.number().positive().nullable(),
    pctChange: z.number().nullable(),
    ret20d: z.number().nullable(),
    ma20Slope: z.number().nullable(),
    volatility20: z.number().min(0).nullable(),
  })).max(100).default([]),
});

export const realtimeQuotePublishSchema = z.object({
  generatedAt: z.string().max(64).optional(),
  quotes: z.array(z.object({
    code: z.string().min(6).max(12),
    instrumentType: z.enum(["stock", "etf", "index"]),
    name: z.string().trim().min(1).max(80).optional(),
    close: z.number().finite().positive(),
    pctChange: z.number().finite(),
    quoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quoteTime: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
    quoteSource: z.enum(["tencent", "sina"]),
  })).min(1).max(6000),
});

export const moneyFlowPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(80),
  rows: z.array(z.object({
    code: z.string().regex(/^\d{6}$/),
    mainNetInflow: z.number().nullable(), mainNetInflowPct: z.number().nullable(),
    superLargeNetInflow: z.number().nullable(), largeNetInflow: z.number().nullable(),
    mediumNetInflow: z.number().nullable(), smallNetInflow: z.number().nullable(),
    mainNetInflow3d: z.number().nullable(), mainNetInflow5d: z.number().nullable(), mainNetInflow10d: z.number().nullable(),
  })).min(1).max(6000),
});

export const industryFundFlowPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(80),
  persistHistory: z.boolean().default(false),
  rows: z.array(z.object({
    industry: z.string().trim().min(1).max(80),
    inflowAmount: z.number().finite().min(0),
    outflowAmount: z.number().finite().min(0),
    netInflow: z.number().finite(),
    companyCount: z.number().int().min(0).nullable(),
    pctChange: z.number().finite().nullable(),
  })).min(1).max(300),
});

export const valuationPublishSchema = z.object({
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1).max(80),
  rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), peTtm: z.number().nullable(), pb: z.number().nullable(), totalMarketCap: z.number().min(0).nullable(), floatMarketCap: z.number().min(0).nullable() })).min(1).max(6000),
});

export const industryPublishSchema = z.object({
  source: z.string().min(1).max(80),
  rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), industry: z.string().trim().min(1).max(80) })).min(1).max(6000),
});

export const financialPublishSchema = z.object({ dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.string().min(1), rows: z.array(z.object({ code: z.string().regex(/^\d{6}$/), reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), announcementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), roe: z.number().nullable(), revenueYoy: z.number().nullable(), profitYoy: z.number().nullable(), grossMargin: z.number().nullable(), debtRatio: z.number().nullable(), revenue: z.number().nullable(), netProfit: z.number().nullable() })).min(1).max(6000) });
