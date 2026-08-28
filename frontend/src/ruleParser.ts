import { ScreenerItem } from "./api";

export interface ParsedCondition {
  field: string;
  fieldLabel: string;
  op: ">" | ">=" | "<" | "<=" | "==" | "!=" | "contains";
  value: number | string;
  rawText: string;
}

export interface RuleParseResult {
  strategyName: string;
  description: string;
  conditions: ParsedCondition[];
  errors: string[];
  matchedItems: ScreenerItem[];
  matchRate: number; // 0 ~ 1
}

const FIELD_ALIAS_MAP: Record<string, { key: keyof ScreenerItem; label: string; isNumeric: boolean }> = {
  ret20d: { key: "ret20d", label: "20日涨跌幅(%)", isNumeric: true },
  "20日涨幅": { key: "ret20d", label: "20日涨跌幅(%)", isNumeric: true },
  "20日收益": { key: "ret20d", label: "20日涨跌幅(%)", isNumeric: true },
  ret20: { key: "ret20d", label: "20日涨跌幅(%)", isNumeric: true },

  ret5d: { key: "ret5d", label: "5日涨跌幅(%)", isNumeric: true },
  "5日涨幅": { key: "ret5d", label: "5日涨跌幅(%)", isNumeric: true },
  "5日收益": { key: "ret5d", label: "5日涨跌幅(%)", isNumeric: true },
  ret5: { key: "ret5d", label: "5日涨跌幅(%)", isNumeric: true },

  ret60d: { key: "ret60d", label: "60日涨跌幅(%)", isNumeric: true },
  "60日涨幅": { key: "ret60d", label: "60日涨跌幅(%)", isNumeric: true },
  "60日收益": { key: "ret60d", label: "60日涨跌幅(%)", isNumeric: true },
  ret60: { key: "ret60d", label: "60日涨跌幅(%)", isNumeric: true },

  ma20slope: { key: "ma20Slope", label: "20日均线斜率", isNumeric: true },
  "20日均线斜率": { key: "ma20Slope", label: "20日均线斜率", isNumeric: true },
  均线斜率: { key: "ma20Slope", label: "20日均线斜率", isNumeric: true },
  maslope: { key: "ma20Slope", label: "20日均线斜率", isNumeric: true },

  volumeratio20: { key: "volumeRatio20", label: "20日平均量比", isNumeric: true },
  "20日量比": { key: "volumeRatio20", label: "20日平均量比", isNumeric: true },
  量比: { key: "volumeRatio20", label: "20日平均量比", isNumeric: true },
  volumeratio: { key: "volumeRatio20", label: "20日平均量比", isNumeric: true },

  volatility20: { key: "volatility20", label: "20日年化波动率", isNumeric: true },
  "20日波动率": { key: "volatility20", label: "20日年化波动率", isNumeric: true },
  波动率: { key: "volatility20", label: "20日年化波动率", isNumeric: true },
  volatility: { key: "volatility20", label: "20日年化波动率", isNumeric: true },

  turnoverrate: { key: "turnoverRate", label: "换手率(%)", isNumeric: true },
  换手率: { key: "turnoverRate", label: "换手率(%)", isNumeric: true },
  turnover: { key: "turnoverRate", label: "换手率(%)", isNumeric: true },

  close: { key: "close", label: "最新收盘价", isNumeric: true },
  收盘价: { key: "close", label: "最新收盘价", isNumeric: true },
  价格: { key: "close", label: "最新收盘价", isNumeric: true },
  price: { key: "close", label: "最新收盘价", isNumeric: true },

  score: { key: "score", label: "量化综合得分", isNumeric: true },
  得分: { key: "score", label: "量化综合得分", isNumeric: true },
  量化分: { key: "score", label: "量化综合得分", isNumeric: true },
  综合得分: { key: "score", label: "量化综合得分", isNumeric: true },

  industry: { key: "industry", label: "行业板块", isNumeric: false },
  行业: { key: "industry", label: "行业板块", isNumeric: false },
  板块: { key: "industry", label: "行业板块", isNumeric: false },

  market: { key: "market", label: "交易市场(SH/SZ)", isNumeric: false },
  市场: { key: "market", label: "交易市场(SH/SZ)", isNumeric: false },
};

export const RULE_TEMPLATES = [
  {
    name: "🚀 强势放量突破模型",
    code: `// 策略：寻找均线向上、放量突破且综合评分较高的强势右侧标的
ret20d >= 8 and volumeRatio20 >= 1.25 and ma20Slope > 0.01 and score >= 75`,
  },
  {
    name: "💎 低波红利稳健模型",
    code: `// 策略：寻找低波动、均线平稳向上的防守型稳健标的
volatility20 <= 0.28 and ma20Slope >= 0 and score >= 65`,
  },
  {
    name: "📈 均线多头共振模型",
    code: `// 策略：20日均线斜率强劲，短中周期收益共振上行
ma20Slope >= 0.025 and ret5d >= 2 and ret20d >= 5 and score >= 70`,
  },
  {
    name: "⚡ 结构化 JSON 策略模板",
    code: `{
  "strategyName": "量价多头爆发模型",
  "description": "寻找均线上行、放量突破且波动率可控的主力建仓标的",
  "conditions": [
    { "field": "ret20d", "op": ">=", "value": 6 },
    { "field": "volumeRatio20", "op": ">", "value": 1.2 },
    { "field": "volatility20", "op": "<=", "value": 0.45 },
    { "field": "score", "op": ">=", "value": 70 }
  ]
}`,
  },
];

export function parseAndEvaluateRules(
  rawInput: string,
  universe: ScreenerItem[]
): RuleParseResult {
  const text = rawInput.trim();
  if (!text) {
    return {
      strategyName: "未命名策略",
      description: "请输入或粘贴外部量化选股规则",
      conditions: [],
      errors: [],
      matchedItems: universe,
      matchRate: universe.length > 0 ? 1 : 0,
    };
  }

  let strategyName = "自定义量化策略";
  let description = "自定义多因子组合过滤规则";
  const conditions: ParsedCondition[] = [];
  const errors: string[] = [];

  // Attempt 1: Try JSON format
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const json = JSON.parse(text) as {
        strategyName?: string;
        description?: string;
        conditions?: Array<{ field: string; op: string; value: number | string }>;
      };
      if (json.strategyName) strategyName = json.strategyName;
      if (json.description) description = json.description;
      if (Array.isArray(json.conditions)) {
        for (const c of json.conditions) {
          const normKey = c.field.trim().toLowerCase();
          const mapped = FIELD_ALIAS_MAP[normKey] || FIELD_ALIAS_MAP[c.field.trim()];
          if (!mapped) {
            errors.push(`未知的指标字段: "${c.field}"`);
            continue;
          }
          const op = (c.op || ">=").trim() as ParsedCondition["op"];
          const val = mapped.isNumeric ? Number(c.value) : String(c.value);
          conditions.push({
            field: mapped.key,
            fieldLabel: mapped.label,
            op,
            value: val,
            rawText: `${mapped.label} ${op} ${val}`,
          });
        }
      }
    } catch {
      errors.push("JSON 格式解析失败，尝试作为普通文本表达式解析。");
    }
  }

  // Attempt 2: Plain text / formula expression
  if (conditions.length === 0) {
    // Strip comments like // or #
    const lines = text
      .split("\n")
      .map((l) => l.replace(/(\/\/|#).*$/, "").trim())
      .filter((l) => l.length > 0);
    const fullExpression = lines.join(" ");

    // Split by and / 且 / , / ;
    const parts = fullExpression.split(/\s+(?:and|AND|&&|且)\s+|[,;，；\n]+/);

    const regex = /([\u4e00-\u9fa5a-zA-Z0-9_]+)\s*(>=|<=|==|!=|>|<|包含|contains|=|:)\s*(['"]?[^'"]+['"]?)/;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const match = regex.exec(trimmed);
      if (!match) {
        continue;
      }

      const rawField = match[1].trim();
      let rawOp = match[2].trim();
      let rawVal: number | string = match[3].trim().replace(/^['"]|['"]$/g, "");

      if (rawOp === "=" || rawOp === ":") rawOp = "==";
      if (rawOp === "包含") rawOp = "contains";

      const normKey = rawField.toLowerCase();
      const mapped = FIELD_ALIAS_MAP[normKey] || FIELD_ALIAS_MAP[rawField];

      if (!mapped) {
        errors.push(`未能识别指标名称: "${rawField}" (支持: 20日涨幅, 量比, 均线斜率, 波动率, 综合分 等)`);
        continue;
      }

      if (mapped.isNumeric) {
        rawVal = parseFloat(rawVal.replace(/%/g, ""));
        if (isNaN(rawVal)) {
          errors.push(`数值格式有误: "${match[3]}"`);
          continue;
        }
      }

      conditions.push({
        field: mapped.key,
        fieldLabel: mapped.label,
        op: rawOp as ParsedCondition["op"],
        value: rawVal,
        rawText: `${mapped.label} ${rawOp} ${rawVal}`,
      });
    }
  }

  // Evaluate against universe
  const matchedItems = universe.filter((item) => {
    return conditions.every((cond) => {
      const itemVal = item[cond.field as keyof ScreenerItem];
      if (itemVal === null || itemVal === undefined) return false;

      if (typeof cond.value === "number") {
        const numVal = Number(itemVal);
        switch (cond.op) {
          case ">":
            return numVal > cond.value;
          case ">=":
            return numVal >= cond.value;
          case "<":
            return numVal < cond.value;
          case "<=":
            return numVal <= cond.value;
          case "==":
            return Math.abs(numVal - cond.value) < 1e-6;
          case "!=":
            return Math.abs(numVal - cond.value) >= 1e-6;
          default:
            return true;
        }
      } else {
        const strVal = String(itemVal).toLowerCase();
        const targetStr = String(cond.value).toLowerCase();
        if (cond.op === "contains") return strVal.includes(targetStr);
        if (cond.op === "==") return strVal === targetStr;
        if (cond.op === "!=") return strVal !== targetStr;
        return strVal.includes(targetStr);
      }
    });
  });

  // Generate intelligent explanation description
  if (conditions.length > 0) {
    const partsDesc: string[] = [];
    for (const c of conditions) {
      if (c.field === "ret20d") partsDesc.push(`近20日涨跌在 ${c.op} ${c.value}%`);
      else if (c.field === "volumeRatio20") partsDesc.push(`20日平均量比 ${c.op} ${c.value}`);
      else if (c.field === "ma20Slope") partsDesc.push(`均线斜率 ${c.op} ${c.value}`);
      else if (c.field === "volatility20") partsDesc.push(`年化波动率 ${c.op} ${c.value}`);
      else if (c.field === "score") partsDesc.push(`综合量化得分 ${c.op} ${c.value}分`);
      else partsDesc.push(`${c.fieldLabel} ${c.op} ${c.value}`);
    }
    description = `策略要求标的必须满足：${partsDesc.join("，并且 ")}。`;
  }

  const matchRate = universe.length > 0 ? matchedItems.length / universe.length : 0;

  return {
    strategyName,
    description,
    conditions,
    errors,
    matchedItems,
    matchRate,
  };
}
