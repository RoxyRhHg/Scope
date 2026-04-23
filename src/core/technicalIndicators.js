function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  let previous = values[0] ?? 0;

  for (const value of values) {
    previous = value * k + previous * (1 - k);
    result.push(previous);
  }

  return result;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function computeMacd(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const diffs = closes.map((_, index) => ema12[index] - ema26[index]);
  const deaSeries = emaSeries(diffs, 9);
  const diff = diffs.at(-1) ?? 0;
  const dea = deaSeries.at(-1) ?? 0;
  const histogram = (diff - dea) * 2;
  const prevDiff = diffs.at(-2) ?? diff;
  const prevDea = deaSeries.at(-2) ?? dea;

  return {
    diff: round(diff, 3),
    dea: round(dea, 3),
    histogram: round(histogram, 3),
    crossedUp: prevDiff <= prevDea && diff > dea,
    crossedDown: prevDiff >= prevDea && diff < dea,
  };
}

function computeBoll(closes, period = 20, multiplier = 2) {
  const slice = closes.slice(-period);
  const middle = average(slice);
  const deviation = stdDev(slice);
  const upper = middle + deviation * multiplier;
  const lower = middle - deviation * multiplier;
  const close = closes.at(-1) ?? middle;

  let position = "mid";
  if (close >= upper) position = "upper-break";
  else if (close > middle) position = "upper-half";
  else if (close <= lower) position = "lower-break";
  else if (close < middle) position = "lower-half";

  return {
    middle: round(middle),
    upper: round(upper),
    lower: round(lower),
    width: round(((upper - lower) / Math.max(middle, 0.0001)) * 100),
    position,
  };
}

function computeKdj(bars, period = 9) {
  let k = 50;
  let d = 50;

  for (let index = 0; index < bars.length; index += 1) {
    const window = bars.slice(Math.max(0, index - period + 1), index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const close = bars[index].close;
    const range = Math.max(highest - lowest, 0.0001);
    const rsv = ((close - lowest) / range) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }

  const j = 3 * k - 2 * d;

  return {
    k: round(k),
    d: round(d),
    j: round(j),
  };
}

function computeVolumeSignal(bars, period = 5) {
  const lastVolume = bars.at(-1)?.volume ?? 0;
  const previousWindow = bars.slice(-(period + 1), -1).map((item) => item.volume);
  const averageVolume = average(previousWindow);
  const ratio = averageVolume ? lastVolume / averageVolume : 1;

  let trend = "flat";
  if (ratio >= 1.35) trend = "expanding";
  else if (ratio <= 0.7) trend = "shrinking";

  return {
    latest: Math.round(lastVolume),
    average: Math.round(averageVolume),
    ratio: round(ratio),
    trend,
  };
}

function inferBias({ macd, boll, kdj, volume, close, previousClose }) {
  let score = 0;

  if (macd.diff > macd.dea) score += 1;
  if (macd.histogram > 0) score += 1;
  if (boll.position === "upper-half" || boll.position === "upper-break") score += 1;
  if (kdj.k > kdj.d && kdj.j > 50) score += 1;
  if (volume.trend === "expanding" && close >= previousClose) score += 1;
  if (boll.position === "lower-half" || boll.position === "lower-break") score -= 1;
  if (kdj.k < kdj.d && kdj.j < 50) score -= 1;
  if (macd.histogram < 0) score -= 1;

  if (score >= 3) return "bullish";
  if (score <= -1) return "bearish";
  return "neutral";
}

export function computeTechnicalSnapshot(bars) {
  if (!Array.isArray(bars) || bars.length < 35) {
    throw new Error("not enough bars for technical indicators");
  }

  const closes = bars.map((item) => Number(item.close));
  const macd = computeMacd(closes);
  const boll = computeBoll(closes);
  const kdj = computeKdj(bars);
  const volume = computeVolumeSignal(bars);
  const close = closes.at(-1) ?? 0;
  const previousClose = closes.at(-2) ?? close;

  return {
    close: round(close),
    previousClose: round(previousClose),
    macd,
    boll,
    kdj,
    volume,
    trend: {
      bias: inferBias({ macd, boll, kdj, volume, close, previousClose }),
    },
  };
}

export function buildTechnicalNarrative(snapshot) {
  const lines = [];

  if (snapshot.macd.crossedUp) {
    lines.push(`MACD 刚出现向上金叉，DIFF ${snapshot.macd.diff} 高于 DEA ${snapshot.macd.dea}。`);
  } else if (snapshot.macd.crossedDown) {
    lines.push(`MACD 刚出现向下死叉，短线动能开始转弱。`);
  } else {
    lines.push(
      `MACD 当前 ${snapshot.macd.diff >= snapshot.macd.dea ? "仍在多头区" : "仍在空头区"}，柱体 ${snapshot.macd.histogram >= 0 ? "为正" : "为负"}。`,
    );
  }

  if (snapshot.boll.position === "upper-break") {
    lines.push(`BOLL 显示价格触及上轨，短线偏强但也要防止追高。`);
  } else if (snapshot.boll.position === "lower-break") {
    lines.push(`BOLL 显示价格压到下轨附近，说明抛压仍在释放。`);
  } else {
    lines.push(`BOLL 中轨 ${snapshot.boll.middle}，价格位于${snapshot.boll.position === "upper-half" ? "中上轨区间" : "中下轨区间"}。`);
  }

  if (snapshot.kdj.k > snapshot.kdj.d && snapshot.kdj.j > 50) {
    lines.push(`KDJ 处于偏强状态，K ${snapshot.kdj.k} / D ${snapshot.kdj.d} / J ${snapshot.kdj.j}。`);
  } else if (snapshot.kdj.k < snapshot.kdj.d && snapshot.kdj.j < 50) {
    lines.push(`KDJ 偏弱，短线资金承接仍需继续观察。`);
  } else {
    lines.push(`KDJ 进入拉锯区，说明短线方向还不够干脆。`);
  }

  if (snapshot.volume.trend === "expanding") {
    lines.push(`成交量放大到近 5 日均量的 ${snapshot.volume.ratio} 倍，资金参与度在提升。`);
  } else if (snapshot.volume.trend === "shrinking") {
    lines.push(`成交量缩到近 5 日均量的 ${snapshot.volume.ratio} 倍，走势延续性要再确认。`);
  } else {
    lines.push(`成交量基本平稳，说明当前更像自然换手。`);
  }

  lines.push(
    `综合判断：当前技术面偏${snapshot.trend.bias === "bullish" ? "多" : snapshot.trend.bias === "bearish" ? "空" : "中性"}，适合把它当作价值框架下的辅助观察，而不是单独替代基本面判断。`,
  );

  return lines;
}
