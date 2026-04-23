import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildRealSnapshot } from "./core/realDataAdapter.js";
import { createSampleSnapshot } from "./core/sampleData.js";
import { buildTechnicalNarrative, computeTechnicalSnapshot } from "./core/technicalIndicators.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const cacheDir = path.join(root, ".cache");
const cacheFile = path.join(cacheDir, "live-snapshot.json");
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);
const liveRefreshMs = 60 * 60 * 1000;

const liveCache = {
  snapshot: null,
  fetchedAt: 0,
  source: "sample",
};
const technicalCache = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function safePathname(requestUrl) {
  const parsed = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(parsed.pathname);
  const candidate = pathname === "/" ? "/public/index.html" : pathname;
  const resolved = path.normalize(path.join(root, candidate));

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

function serveFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(JSON.stringify(payload));
}

function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return parsed;
  } catch {
    return null;
  }
}

function saveCacheToDisk(payload) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(payload), "utf8");
}

async function fetchLiveSnapshot(force = false) {
  const now = Date.now();
  if (!force && liveCache.snapshot && now - liveCache.fetchedAt < liveRefreshMs) {
    return { snapshot: liveCache.snapshot, source: liveCache.source, cached: true };
  }

  try {
    const { stdout } = await execFileAsync("python", [path.join(root, "scripts", "fetch_live_snapshot.py")], {
      cwd: root,
      maxBuffer: 50 * 1024 * 1024,
    });

    const raw = JSON.parse(stdout.trim());
    const snapshot = buildRealSnapshot(raw);
    liveCache.snapshot = snapshot;
    liveCache.fetchedAt = now;
    liveCache.source = "live";
    saveCacheToDisk({ fetchedAt: now, snapshot, source: "live" });
    return { snapshot, source: "live", cached: false };
  } catch (error) {
    const diskCache = loadCacheFromDisk();
    if (diskCache?.snapshot) {
      liveCache.snapshot = diskCache.snapshot;
      liveCache.fetchedAt = diskCache.fetchedAt ?? now;
      liveCache.source = diskCache.source ?? "live-cache";
      return {
        snapshot: diskCache.snapshot,
        source: diskCache.source ?? "live-cache",
        cached: true,
        warning: `live fetch failed: ${error.message}`,
      };
    }

    const snapshot = createSampleSnapshot();
    return {
      snapshot,
      source: "sample",
      cached: false,
      warning: `live fetch failed: ${error.message}`,
    };
  }
}

function buildFallbackBars(code) {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 10 + index * 0.18 + Math.sin(index / 6) * 0.4;
    return {
      date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
      open: round(close - 0.12, 2),
      high: round(close + 0.28, 2),
      low: round(close - 0.32, 2),
      close: round(close, 2),
      volume: 120000 + index * 1600,
      code,
    };
  });
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function fetchTechnicalPayload(code, force = false) {
  const cacheKey = String(code);
  const now = Date.now();
  const cached = technicalCache.get(cacheKey);

  if (!force && cached && now - cached.fetchedAt < 15 * 60 * 1000) {
    return { ...cached, cached: true };
  }

  try {
    const { stdout } = await execFileAsync("python", [path.join(root, "scripts", "fetch_stock_history.py"), cacheKey], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });

    const raw = JSON.parse(stdout.trim());
    const snapshot = computeTechnicalSnapshot(raw.bars);
    const payload = {
      code: cacheKey,
      bars: raw.bars,
      snapshot,
      analysis: buildTechnicalNarrative(snapshot),
      fetchedAt: now,
      source: "live",
    };
    technicalCache.set(cacheKey, payload);
    return { ...payload, cached: false };
  } catch (error) {
    const bars = buildFallbackBars(cacheKey);
    const snapshot = computeTechnicalSnapshot(bars);
    return {
      code: cacheKey,
      bars,
      snapshot,
      analysis: buildTechnicalNarrative(snapshot),
      fetchedAt: now,
      source: "sample",
      cached: false,
      warning: `technical fetch failed: ${error.message}`,
    };
  }
}

const server = http.createServer((request, response) => {
  const parsedRequest = new URL(request.url ?? "/", "http://127.0.0.1");

  if (parsedRequest.pathname === "/api/dashboard") {
    const force = parsedRequest.searchParams.get("force") === "1";
    fetchLiveSnapshot(force)
      .then(({ snapshot, source, cached, warning }) => {
        sendJson(response, 200, {
          source,
          cached,
          warning: warning ?? null,
          snapshot,
        });
      })
      .catch((error) => {
        sendJson(response, 500, {
          error: error.message,
        });
      });
    return;
  }

  if (parsedRequest.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      hasLiveCache: Boolean(liveCache.snapshot),
      fetchedAt: liveCache.fetchedAt || null,
      source: liveCache.source,
    });
    return;
  }

  if (parsedRequest.pathname === "/api/technicals") {
    const code = parsedRequest.searchParams.get("code");
    const force = parsedRequest.searchParams.get("force") === "1";

    if (!code) {
      sendJson(response, 400, { error: "code is required" });
      return;
    }

    fetchTechnicalPayload(code, force)
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => sendJson(response, 500, { error: error.message }));
    return;
  }

  const filePath = safePathname(request.url ?? "/");

  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (filePath === path.join(root, "favicon.ico")) {
    response.writeHead(204);
    response.end();
    return;
  }

  if (filePath === publicDir && fs.existsSync(path.join(publicDir, "index.html"))) {
    serveFile(path.join(publicDir, "index.html"), response);
    return;
  }

  serveFile(filePath, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Scope MVP running at http://127.0.0.1:${port}`);
});
