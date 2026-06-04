import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const industryCacheFile = path.join(root, ".cache", "industry-map.json");

const HEADERS = {
  Referer: "https://finance.sina.com.cn",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const SINA_API =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
const SINA_COUNT_API =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount";
const SINA_BOARD_META =
  "https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php";

function httpsGet(targetUrl, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;
    const parsed = new URL(fullUrl);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.get(
      fullUrl,
      { headers: HEADERS, timeout, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          // Sina returns GBK encoding
          const text = buf.toString("utf-8");
          resolve({ status: res.statusCode, text });
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${fullUrl}`));
    });
  });
}

function retryGet(targetUrl, params = {}, retries = 3, delay = 1500) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryOnce() {
      attempt++;
      httpsGet(targetUrl, params)
        .then((res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.text);
          } else if (attempt < retries) {
            setTimeout(tryOnce, delay * attempt);
          } else {
            reject(new Error(`HTTP ${res.status} after ${retries} retries: ${targetUrl}`));
          }
        })
        .catch((err) => {
          if (attempt < retries) {
            setTimeout(tryOnce, delay * attempt);
          } else {
            reject(err);
          }
        });
    }

    tryOnce();
  });
}

function parseSinaJson(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[]") return [];
  return JSON.parse(trimmed);
}

async function fetchPageCount() {
  const text = await retryGet(SINA_COUNT_API, { node: "hs_a" });
  const cleaned = text.trim().replace(/^"|"$/g, "");
  return parseInt(cleaned, 10) || 5600;
}

async function fetchPage(page, num = 80) {
  const text = await retryGet(SINA_API, {
    page: String(page),
    num: String(num),
    sort: "symbol",
    asc: "1",
    node: "hs_a",
    symbol: "",
    _s_r_a: "page",
  });
  return parseSinaJson(text);
}

export async function fetchAllSpot() {
  const total = await fetchPageCount();
  const pages = Math.ceil(total / 80);

  // 并行抓取所有页，带随机延迟避免限流
  const promises = [];
  for (let i = 1; i <= pages; i++) {
    const delay = Math.random() * 200; // 0-200ms random jitter
    promises.push(
      new Promise((resolve) => setTimeout(resolve, delay)).then(() =>
        fetchPage(i).catch((err) => {
          console.warn(`[dataFetcher] page ${i}/${pages} failed: ${err.message}`);
          return [];
        })
      )
    );
  }

  const results = await Promise.all(promises);
  const rows = results.flat();
  console.log(`[dataFetcher] fetched ${rows.length} stocks from ${pages} pages`);
  return rows;
}

export function loadIndustryMap() {
  try {
    if (!fs.existsSync(industryCacheFile)) {
      console.warn("[dataFetcher] industry cache not found, using empty map");
      return [];
    }
    const raw = fs.readFileSync(industryCacheFile, "utf8");
    const data = JSON.parse(raw);
    console.log(`[dataFetcher] loaded ${data.length} industry groups from cache`);
    return data;
  } catch (err) {
    console.warn(`[dataFetcher] failed to load industry cache: ${err.message}`);
    return [];
  }
}

async function fetchConceptMeta() {
  const text = await retryGet(SINA_BOARD_META, { param: "class" });
  const match = text.trim().match(/=\s*(\{.*\})\s*;?$/);
  if (!match) return [];

  const payload = JSON.parse(match[1]);
  const concepts = [];

  for (const [node, raw] of Object.entries(payload)) {
    const parts = raw.split(",");
    if (parts.length < 3) continue;
    concepts.push({
      node,
      concept: parts[1],
      count: parseInt(parts[2] || "0", 10),
      avg_price: parseFloat(parts[3] || "0") || 0,
      change_percent: parseFloat(parts[4] || "0") || 0,
      lead_code: parts[8] || "",
      lead_name: parts[12] || "",
    });
  }

  concepts.sort(
    (a, b) => b.count - a.count || Math.abs(b.change_percent) - Math.abs(a.change_percent)
  );
  return concepts;
}

async function fetchConceptMembers(node, maxMembers = 180) {
  const count = Math.max(1, Math.min(maxMembers, 80));
  const pages = Math.ceil(count / 80);
  const stocks = [];

  for (let page = 1; page <= pages; page++) {
    try {
      const rows = await fetchPage(node, 80);
      for (const row of rows) {
        stocks.push({ code: row.code || row.代码, name: row.name || row.名称 });
      }
    } catch {
      break;
    }
  }

  return stocks;
}

export async function fetchTopConcepts(topN = 24) {
  try {
    const meta = await fetchConceptMeta();
    const top = meta.slice(0, topN);
    const result = [];

    for (const item of top) {
      try {
        const stocks = await fetchConceptMembers(item.node);
        result.push({
          concept: item.concept,
          node: item.node,
          count: stocks.length,
          change_percent: item.change_percent,
          stocks,
        });
      } catch {
        result.push({
          concept: item.concept,
          node: item.node,
          count: 0,
          change_percent: item.change_percent,
          stocks: [],
        });
      }
    }

    return result;
  } catch (err) {
    console.warn(`[dataFetcher] concept fetch failed: ${err.message}`);
    return [];
  }
}

export async function fetchFullSnapshot() {
  const [spot, concepts] = await Promise.all([
    fetchAllSpot(),
    fetchTopConcepts().catch(() => []),
  ]);

  const industries = loadIndustryMap();

  return {
    generatedAt: new Date().toISOString(),
    note: "实时行情来自新浪分页行情接口（Node.js 并行抓取），行业映射来自本地缓存，概念为新浪热门概念。",
    spot,
    industries,
    concepts,
  };
}
