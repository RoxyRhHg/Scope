import { buildDashboardModel, createDefaultSettings } from "../src/core/dashboard.js";
import { createSampleSnapshot, SAMPLE_MODE_NOTE } from "../src/core/sampleData.js";

const STORAGE_KEY = "scope-buffett-mvp-state";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

const app = document.getElementById("app");
const baseSettings = createDefaultSettings();
const persisted = loadState();

const state = {
  iteration: persisted.iteration ?? 0,
  lastRefreshAt: persisted.lastRefreshAt ?? Date.now(),
  snapshot: null,
  sourceMode: persisted.sourceMode ?? "sample",
  sourceWarning: null,
  isLoading: true,
  technicalLoading: false,
  technicalWarning: null,
  technicalByCode: {},
  settings: {
    ...baseSettings,
    ...persisted.settings,
    weights: {
      ...baseSettings.weights,
      ...(persisted.settings?.weights ?? {}),
      coreBreakdown: {
        ...baseSettings.weights.coreBreakdown,
        ...(persisted.settings?.weights?.coreBreakdown ?? {}),
      },
      auxiliaryBreakdown: {
        ...baseSettings.weights.auxiliaryBreakdown,
        ...(persisted.settings?.weights?.auxiliaryBreakdown ?? {}),
      },
      capitalBreakdown: {
        ...baseSettings.weights.capitalBreakdown,
        ...(persisted.settings?.weights?.capitalBreakdown ?? {}),
      },
    },
    thresholds: {
      ...baseSettings.thresholds,
      ...(persisted.settings?.thresholds ?? {}),
    },
  },
  selectedCode: persisted.selectedCode ?? null,
};

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      iteration: state.iteration,
      lastRefreshAt: state.lastRefreshAt,
      settings: state.settings,
      selectedCode: state.selectedCode,
      sourceMode: state.sourceMode,
    }),
  );
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPercent(value) {
  return `${round(value)}%`;
}

function formatCurrency(value) {
  return `¥${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function timeUntilRefresh() {
  const elapsed = Date.now() - state.lastRefreshAt;
  const remain = Math.max(0, REFRESH_INTERVAL_MS - elapsed);
  const minutes = Math.floor(remain / 60000);
  const seconds = Math.floor((remain % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSnapshot() {
  return state.snapshot ?? createSampleSnapshot(state.iteration);
}

function getModel() {
  const snapshot = getSnapshot();
  const model = buildDashboardModel(snapshot, state.settings);

  if (!state.selectedCode) {
    state.selectedCode = model.focus[0]?.code || model.top50[0]?.code || model.rankedAll[0]?.code || null;
  }

  return model;
}

function normalizeWeightMap(map) {
  const entries = Object.entries(map);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0) || 1;
  return Object.fromEntries(entries.map(([key, value]) => [key, round((Number(value) / total) * 100)]));
}

function buildReasonList(stock) {
  const positives = [
    ["商业质量", stock.metrics.businessQuality],
    ["盈利质量", stock.metrics.profitability],
    ["现金流", stock.metrics.cashFlow],
    ["负债安全", stock.metrics.balanceSheet],
    ["估值边际", stock.metrics.valuation],
    ["经营稳定", stock.metrics.stability],
  ]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label]) => `${label}表现靠前`);

  if (stock.scores.auxiliary >= 72) {
    positives.push("行业景气与事件催化仍在提供支持");
  }

  if (stock.scores.capitalFit >= 74) {
    positives.push("对几千到一万多的小资金更友好");
  }

  return positives.slice(0, 4);
}

function buildRiskList(stock) {
  const risks = [...stock.riskFlags];

  if (!risks.length && stock.metrics.conceptHeat > 70) {
    risks.push("主题关注度较高，情绪回落时波动可能放大");
  }

  if (stock.metrics.stability < 68) {
    risks.push("经营稳定性一般，需要继续跟踪季度兑现");
  }

  if (stock.valuationCard.status === "偏高估") {
    risks.push("当前估值位置偏贵，等待更好安全边际");
  }

  risks.push(stock.riskNote);

  return Array.from(new Set(risks)).slice(0, 3);
}

function buildCapitalFitNarrative(stock) {
  if (stock.scores.capitalFit >= 75) {
    return `以你当前约 ${formatCurrency(state.settings.availableCapital)} 的可用资金，这只股票的单手成本 ${formatCurrency(stock.lotCost)} 比较友好，适合作为 1-2 只集中观察对象。`;
  }

  if (stock.scores.capitalFit >= 60) {
    return `单手成本 ${formatCurrency(stock.lotCost)} 尚可接受，但波动和仓位利用率需要更谨慎。`;
  }

  return `对你当前资金体量而言，单手成本或波动适配一般，更适合作为候选观察而不是当前重仓首选。`;
}

function getSelectedStock(model) {
  return (
    model.rankedAll.find((item) => item.code === state.selectedCode) ||
    model.focus[0] ||
    model.top50[0] ||
    model.rankedAll[0]
  );
}

function getTechnicalPayload(code) {
  return state.technicalByCode[code] ?? null;
}

async function loadDashboard(force = false) {
  state.isLoading = true;
  render();

  try {
    const response = await fetch(`/api/dashboard${force ? "?force=1" : ""}`);
    if (!response.ok) {
      throw new Error(`dashboard api ${response.status}`);
    }

    const payload = await response.json();
    state.snapshot = payload.snapshot;
    state.sourceMode = payload.source ?? payload.snapshot?.mode ?? "live";
    state.sourceWarning = payload.warning ?? null;
    state.lastRefreshAt = Date.now();
  } catch (error) {
    state.snapshot = createSampleSnapshot(state.iteration);
    state.sourceMode = "sample";
    state.sourceWarning = `live API 不可用，已回退样例数据：${error.message}`;
  } finally {
    state.isLoading = false;
    saveState();
    render();
    if (state.selectedCode) {
      loadTechnicals(state.selectedCode);
    }
  }
}

async function loadTechnicals(code, force = false) {
  if (!code) return;
  if (!force && state.technicalByCode[code]) return;

  state.technicalLoading = true;
  state.technicalWarning = null;
  render();

  try {
    const response = await fetch(`/api/technicals?code=${encodeURIComponent(code)}${force ? "&force=1" : ""}`);
    if (!response.ok) {
      throw new Error(`technical api ${response.status}`);
    }

    const payload = await response.json();
    state.technicalByCode[code] = payload;
    state.technicalWarning = payload.warning ?? null;
  } catch (error) {
    state.technicalWarning = `技术指标暂时不可用：${error.message}`;
  } finally {
    state.technicalLoading = false;
    render();
  }
}

function renderTechnicalBlock(stock) {
  const technical = getTechnicalPayload(stock.code);

  if (state.technicalLoading && !technical) {
    return `<section class="detail-block"><h3>技术指标分析</h3><p>正在拉取 ${stock.name} 的日线数据并计算 MACD、BOLL、KDJ、成交量特征...</p></section>`;
  }

  if (!technical) {
    return `<section class="detail-block"><h3>技术指标分析</h3><p>当前还没有技术指标数据。你可以点击手动刷新后再查看。</p></section>`;
  }

  return `
    <section class="detail-block">
      <h3>技术指标分析</h3>
      <div class="tech-grid">
        <div class="tech-item"><span>MACD</span><strong>DIFF ${technical.snapshot.macd.diff}</strong><small>DEA ${technical.snapshot.macd.dea} · 柱 ${technical.snapshot.macd.histogram}</small></div>
        <div class="tech-item"><span>BOLL</span><strong>${technical.snapshot.boll.position}</strong><small>上 ${technical.snapshot.boll.upper} / 中 ${technical.snapshot.boll.middle} / 下 ${technical.snapshot.boll.lower}</small></div>
        <div class="tech-item"><span>KDJ</span><strong>K ${technical.snapshot.kdj.k}</strong><small>D ${technical.snapshot.kdj.d} · J ${technical.snapshot.kdj.j}</small></div>
        <div class="tech-item"><span>成交量</span><strong>${technical.snapshot.volume.ratio} 倍</strong><small>近 5 日均量对比，状态 ${technical.snapshot.volume.trend}</small></div>
      </div>
      <ul class="technical-list">
        ${technical.analysis.map((line) => `<li>${line}</li>`).join("")}
      </ul>
      <p class="muted">综合多空倾向：${technical.snapshot.trend.bias === "bullish" ? "偏多" : technical.snapshot.trend.bias === "bearish" ? "偏空" : "中性"}。这里是辅助判断，不替代 Buffett 主框架。</p>
      ${technical.warning ? `<p class="muted">${technical.warning}</p>` : ""}
    </section>
  `;
}

function render() {
  const model = getModel();
  const selectedStock = getSelectedStock(model);
  const overallWeights = normalizeWeightMap({
    core: state.settings.weights.core,
    auxiliary: state.settings.weights.auxiliary,
    capitalFit: state.settings.weights.capitalFit,
  });
  const coreWeights = normalizeWeightMap(state.settings.weights.coreBreakdown);
  const sourceNote =
    state.sourceMode === "live" || state.sourceMode === "live-cache"
      ? model.snapshot.note ?? "当前使用真实数据模式。"
      : SAMPLE_MODE_NOTE;

  app.innerHTML = `
    <div class="layout">
      <aside class="panel sidebar">
        <div>
          <div class="eyebrow">Scope / MVP</div>
          <h2>参数面板</h2>
          <small>当前会优先请求真实 A 股快照数据，若接口不可用则自动回退到样例数据，不影响继续使用。</small>
        </div>

        <div class="sidebar-card">
          <div class="slider-line">
            <div class="slider-head">
              <label for="capitalInput">可用资金</label>
              <strong>${formatCurrency(state.settings.availableCapital)}</strong>
            </div>
            <input class="input" id="capitalInput" type="number" min="1000" step="500" value="${state.settings.availableCapital}" />
          </div>
        </div>

        <div class="sidebar-card">
          <div class="filter-group">
            <div class="slider-line">
              <label for="industrySelect">行业筛选</label>
              <select class="select" id="industrySelect">
                <option value="全部行业">全部行业</option>
                ${model.industries
                  .map(
                    (item) =>
                      `<option value="${item.industry}" ${item.industry === state.settings.selectedIndustry ? "selected" : ""}>${item.industry}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="slider-line">
              <label for="conceptSelect">概念筛选</label>
              <select class="select" id="conceptSelect">
                ${model.availableConcepts
                  .map(
                    (concept) =>
                      `<option value="${concept}" ${concept === state.settings.selectedConcept ? "selected" : ""}>${concept}</option>`,
                  )
                  .join("")}
              </select>
            </div>
          </div>
        </div>

        <div class="sidebar-card">
          <div class="slider-line">
            <div class="slider-head"><label>总权重：核心价值</label><strong>${overallWeights.core}%</strong></div>
            <input type="range" min="0.3" max="0.9" step="0.01" value="${state.settings.weights.core}" data-weight-group="top" data-key="core" />
          </div>
          <div class="slider-line">
            <div class="slider-head"><label>总权重：主题辅助</label><strong>${overallWeights.auxiliary}%</strong></div>
            <input type="range" min="0.05" max="0.4" step="0.01" value="${state.settings.weights.auxiliary}" data-weight-group="top" data-key="auxiliary" />
          </div>
          <div class="slider-line">
            <div class="slider-head"><label>总权重：资金适配</label><strong>${overallWeights.capitalFit}%</strong></div>
            <input type="range" min="0.05" max="0.35" step="0.01" value="${state.settings.weights.capitalFit}" data-weight-group="top" data-key="capitalFit" />
          </div>
        </div>

        <div class="sidebar-card">
          <div class="detail-kicker">核心价值分细项</div>
          ${[
            ["businessQuality", "商业质量"],
            ["profitability", "盈利质量"],
            ["cashFlow", "现金流"],
            ["balanceSheet", "负债安全"],
            ["valuation", "估值边际"],
            ["stability", "经营稳定"],
          ]
            .map(
              ([key, label]) => `
                <div class="slider-line">
                  <div class="slider-head"><label>${label}</label><strong>${coreWeights[key]}%</strong></div>
                  <input type="range" min="0.05" max="0.4" step="0.01" value="${state.settings.weights.coreBreakdown[key]}" data-weight-group="coreBreakdown" data-key="${key}" />
                </div>
              `,
            )
            .join("")}
        </div>

        <div class="sidebar-card">
          <div class="detail-kicker">刷新控制</div>
          <p class="muted">自动刷新：每小时一次。当前倒计时 ${timeUntilRefresh()}。</p>
          <div class="button-row">
            <button class="button primary" id="refreshButton">${state.isLoading ? "正在刷新..." : "手动刷新"}</button>
            <button class="button secondary" id="resetButton">恢复默认权重</button>
          </div>
          ${state.sourceWarning ? `<p class="muted" style="margin-top:10px;">${state.sourceWarning}</p>` : ""}
          ${state.technicalWarning ? `<p class="muted" style="margin-top:10px;">${state.technicalWarning}</p>` : ""}
        </div>
      </aside>

      <main class="main">
        <section class="panel hero">
          <div class="eyebrow">A/H Scout · Buffett-first ranking board</div>
          <h1>小资金也能用的<br />A股价值筛选看板</h1>
          <p>${
            state.isLoading
              ? "正在拉取最新市场快照，若真实数据不可用会自动回退到样例数据，不影响你继续使用界面。"
              : "当前界面会优先使用真实 A 股快照，并在失败时自动回退到样例模式。核心排序仍坚持 Buffett 主评分优先，主题和资金适配只做辅助修正。"
          }</p>
          <div class="hero-meta">
            <div class="meta-card">
              <div class="meta-label">运行模式</div>
              <div class="meta-value">${state.sourceMode === "live" || state.sourceMode === "live-cache" ? "真实" : "样例"}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">可推荐股票</div>
              <div class="meta-value">${model.eligibleCount}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">默认剔除</div>
              <div class="meta-value">${model.excludedCount}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">上次刷新</div>
              <div class="meta-value">${new Date(state.lastRefreshAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}</div>
            </div>
          </div>
        </section>

        <section class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">重点关注 1-2 只</h2>
              <p class="section-subtitle">先从最适合你当前资金画像的小资金高集中候选开始。</p>
            </div>
            <span class="badge gold">Buffett 主评分优先</span>
          </div>
          <div class="focus-grid">
            ${
              model.focus.length
                ? model.focus
                    .map(
                      (stock) => `
                        <article class="stock-card" data-code="${stock.code}">
                          <div class="stock-head">
                            <div>
                              <div class="chip-row">
                                <span class="badge primary">重点</span>
                                <span class="chip">${stock.industry}</span>
                              </div>
                              <div class="stock-name">${stock.name}</div>
                              <div class="muted">${stock.code}.${stock.market} · ${stock.conclusion}</div>
                            </div>
                            <div class="stock-price">
                              <div class="price-number">${stock.price.toFixed(2)}</div>
                              <div class="price-change ${stock.metrics.conceptHeat > 70 ? "up" : "down"}">${stock.valuationCard.status} · 安全边际 ${formatPercent(stock.valuationCard.marginOfSafety)}</div>
                            </div>
                          </div>
                          <div class="tag-list">${stock.concepts.slice(0, 3).map((concept) => `<span class="tag">${concept}</span>`).join("")}</div>
                          <div class="score-grid">
                            <div class="score-box"><div class="mini-label">总分</div><div class="score-value">${stock.scores.total}</div></div>
                            <div class="score-box"><div class="mini-label">资金适配</div><div class="score-value">${stock.scores.capitalFit}</div></div>
                          </div>
                          <p class="stock-summary">${buildReasonList(stock).slice(0, 2).join("，")}。</p>
                        </article>
                      `,
                    )
                    .join("")
                : `<div class="summary-card"><div class="mini-label">暂无重点股</div><p class="stock-summary">当前筛选条件下没有足够适合重仓的标的，这时不凑数比硬给答案更重要。</p></div>`
            }
          </div>
        </section>

        <section class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">行业概览</h2>
              <p class="section-subtitle">行业先作为主筛选，概念只做轻量辅助。</p>
            </div>
            <span class="muted">${sourceNote}</span>
          </div>
          <div class="industry-strip">
            ${model.industries
              .slice(0, 8)
              .map(
                (item) => `
                  <article class="industry-card" data-industry="${item.industry}">
                    <div class="row-main">
                      <div>
                        <div class="industry-name">${item.industry}</div>
                        <div class="muted">${item.count} 只候选</div>
                      </div>
                      <div class="industry-score">${item.averageTotal}</div>
                    </div>
                    <div class="bar"><span style="width:${Math.min(item.averageTotal, 100)}%"></span></div>
                    <div class="muted">核心 ${item.averageCore} · 辅助 ${item.averageAuxiliary}</div>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>

        <section class="panel section">
          <div class="section-header">
            <div>
              <h2 class="section-title">总榜与行业榜</h2>
              <p class="section-subtitle">左边看全市场 Top 50，右边看当前行业下的 Top 20。</p>
            </div>
          </div>
          <div class="split-grid">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>股票</th>
                    <th>行业</th>
                    <th>总分</th>
                    <th>价值分</th>
                    <th>主题分</th>
                    <th>资金适配</th>
                    <th class="hidden-mobile">估值</th>
                  </tr>
                </thead>
                <tbody>
                  ${model.top50
                    .map(
                      (stock, index) => `
                        <tr class="stock-row ${stock.code === state.selectedCode ? "active" : ""}" data-code="${stock.code}">
                          <td>${index + 1}</td>
                          <td>
                            <div><strong>${stock.name}</strong></div>
                            <div class="muted">${stock.code}.${stock.market}</div>
                          </td>
                          <td>${stock.industry}</td>
                          <td>${stock.scores.total}</td>
                          <td>${stock.scores.core}</td>
                          <td>${stock.scores.auxiliary}</td>
                          <td>${stock.scores.capitalFit}</td>
                          <td class="hidden-mobile">${stock.valuationCard.status}</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </tbody>
              </table>
              <div class="footer-note">当前筛选：${state.settings.selectedIndustry || "全部行业"} / ${state.settings.selectedConcept || "全部概念"}。如果核心价值分不过线，再热的主题也不会排到前列。</div>
            </div>

            <div class="sector-wrap">
              <div class="section-header">
                <div>
                  <h2 class="section-title">${model.selectedIndustry} Top 20</h2>
                  <p class="section-subtitle">你点击行业后，这里会收敛到同一行业内更值得展开看的股票。</p>
                </div>
              </div>
              <div class="sector-list">
                ${model.sectorTop
                  .map(
                    (stock, index) => `
                      <article class="sector-item ${stock.code === state.selectedCode ? "active" : ""}" data-code="${stock.code}">
                        <div class="row-main">
                          <div>
                            <strong>${index + 1}. ${stock.name}</strong>
                            <div class="muted">${stock.conclusion}</div>
                          </div>
                          <strong>${stock.scores.total}</strong>
                        </div>
                        <div class="tag-list">${stock.concepts.slice(0, 2).map((concept) => `<span class="tag">${concept}</span>`).join("")}</div>
                      </article>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </section>
      </main>

      <aside class="panel detail">
        ${
          selectedStock
            ? `
              <div class="detail-top">
                <div>
                  <div class="chip-row">
                    <span class="badge primary">${selectedStock.conclusion}</span>
                    <span class="chip">${selectedStock.industry}</span>
                    <span class="chip">${selectedStock.valuationCard.status}</span>
                  </div>
                  <div class="detail-stock-name">${selectedStock.name}</div>
                  <small>${selectedStock.code}.${selectedStock.market} · 单手成本 ${formatCurrency(selectedStock.lotCost)}</small>
                </div>
                <div class="stock-price">
                  <div class="price-number">${selectedStock.price.toFixed(2)}</div>
                  <div class="price-change ${selectedStock.valuationCard.marginOfSafety >= 0 ? "up" : "down"}">安全边际 ${formatPercent(selectedStock.valuationCard.marginOfSafety)}</div>
                </div>
              </div>

              <div class="detail-scores">
                <div class="detail-score"><span class="mini-label">总分</span><strong>${selectedStock.scores.total}</strong></div>
                <div class="detail-score"><span class="mini-label">价值分</span><strong>${selectedStock.scores.core}</strong></div>
                <div class="detail-score"><span class="mini-label">主题分</span><strong>${selectedStock.scores.auxiliary}</strong></div>
                <div class="detail-score"><span class="mini-label">资金适配</span><strong>${selectedStock.scores.capitalFit}</strong></div>
              </div>

              <div class="detail-grid">
                <section class="detail-block">
                  <h3>为什么它能入选</h3>
                  <ul>${buildReasonList(selectedStock).map((item) => `<li>${item}</li>`).join("")}</ul>
                </section>
                <section class="detail-block">
                  <h3>Buffett 视角</h3>
                  <p>${selectedStock.summary}</p>
                  <ul>
                    <li>商业质量 ${selectedStock.metrics.businessQuality} / 100</li>
                    <li>盈利质量 ${selectedStock.metrics.profitability} / 100</li>
                    <li>现金流质量 ${selectedStock.metrics.cashFlow} / 100</li>
                    <li>资产负债安全 ${selectedStock.metrics.balanceSheet} / 100</li>
                  </ul>
                </section>
                <section class="detail-block">
                  <h3>详细估值卡</h3>
                  <ul>
                    <li>估值状态：${selectedStock.valuationCard.status}</li>
                    <li>建议关注区间：${selectedStock.valuationCard.buyRangeLow.toFixed(2)} - ${selectedStock.valuationCard.buyRangeHigh.toFixed(2)}</li>
                    <li>保守估值：${selectedStock.valuationCard.conservativeValue.toFixed(2)}</li>
                    <li>乐观估值：${selectedStock.valuationCard.optimisticValue.toFixed(2)}</li>
                  </ul>
                </section>
                <section class="detail-block">
                  <h3>主要风险</h3>
                  <ul>${buildRiskList(selectedStock).map((item) => `<li>${item}</li>`).join("")}</ul>
                </section>
                ${renderTechnicalBlock(selectedStock)}
                <section class="detail-block">
                  <h3>小资金适配说明</h3>
                  <p>${buildCapitalFitNarrative(selectedStock)}</p>
                  <div class="tag-list">
                    ${selectedStock.concepts.map((concept) => `<span class="tag">${concept}</span>`).join("")}
                  </div>
                </section>
              </div>
            `
            : `<div class="summary-card"><p class="stock-summary">当前没有可展示的个股详情。</p></div>`
        }
      </aside>
    </div>
  `;

  attachEvents();
}

function attachEvents() {
  document.getElementById("capitalInput")?.addEventListener("change", (event) => {
    state.settings.availableCapital = Math.max(1000, Number(event.target.value) || 1000);
    persistAndRender();
  });

  document.getElementById("industrySelect")?.addEventListener("change", (event) => {
    state.settings.selectedIndustry = event.target.value;
    persistAndRender();
  });

  document.getElementById("conceptSelect")?.addEventListener("change", (event) => {
    state.settings.selectedConcept = event.target.value;
    persistAndRender();
  });

  document.querySelectorAll("[data-weight-group]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const { weightGroup, key } = event.target.dataset;
      const value = Number(event.target.value);

      if (weightGroup === "top") {
        state.settings.weights[key] = value;
        if (state.settings.weights.core < 0.5) {
          state.settings.weights.core = 0.5;
        }
      } else {
        state.settings.weights[weightGroup][key] = value;
      }

      persistAndRender();
    });
  });

  document.getElementById("refreshButton")?.addEventListener("click", () => {
    refreshNow();
  });

  document.getElementById("resetButton")?.addEventListener("click", () => {
    const defaults = createDefaultSettings();
    state.settings = {
      ...state.settings,
      weights: defaults.weights,
      thresholds: defaults.thresholds,
    };
    persistAndRender();
  });

  document.querySelectorAll("[data-code]").forEach((node) => {
    node.addEventListener("click", () => {
      const code = node.dataset.code;
      state.selectedCode = code;
      persistAndRender();
      loadTechnicals(code);
    });
  });

  document.querySelectorAll("[data-industry]").forEach((node) => {
    node.addEventListener("click", () => {
      state.settings.selectedIndustry = node.dataset.industry;
      persistAndRender();
    });
  });
}

function refreshNow() {
  state.iteration += 1;
  if (state.selectedCode) {
    delete state.technicalByCode[state.selectedCode];
  }
  loadDashboard(true);
}

function persistAndRender() {
  saveState();
  render();
}

setInterval(() => {
  if (Date.now() - state.lastRefreshAt >= REFRESH_INTERVAL_MS) {
    refreshNow();
    return;
  }

  const refreshButton = document.getElementById("refreshButton");
  if (refreshButton && !state.isLoading) {
    refreshButton.textContent = `手动刷新（${timeUntilRefresh()}）`;
  }
}, 1000);

loadDashboard();
