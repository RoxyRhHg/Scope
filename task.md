# 当前状态

## 已完成

- 已完成产品设计规格文档：
  - `2026-04-23-a股-buffett-桌面选股程序-设计规格.md`
- 已实现初版 MVP：
  - `public/index.html`
  - `public/styles.css`
  - `public/app.js`
  - `src/core/ranking.js`
  - `src/core/dashboard.js`
  - `src/core/sampleData.js`
  - `src/core/realDataAdapter.js`
  - `src/server.js`
  - `scripts/fetch_live_snapshot.py`
  - `src-tauri/`
- 已补基础测试：
  - `tests/ranking.test.js`
- 已验证：
  - `npm test` 通过
  - 本地 `http://127.0.0.1:4173/` 可返回 200
  - `http://127.0.0.1:4173/api/dashboard?force=1` 可返回 `live` 模式真实快照
  - `npx tauri info` 环境自检通过

## 当前 MVP 能做什么

- 用真实 A 股快照或样例数据跑通 Buffett 主评分 + 主题辅助排序
- 展示全市场 Top 50
- 展示行业 Top 20
- 给出重点关注 1-2 只
- 支持资金量调整
- 支持权重调节
- 支持行业/概念筛选
- 支持手动刷新
- 支持每小时自动刷新倒计时
- 支持个股详细估值卡和风险说明
- 支持个股详细卡片中的技术指标分析：
  - MACD
  - BOLL
  - KDJ
  - 成交量
  - 综合多空判断
- 支持本地 API 缓存与 live/sample 自动回退
- 已具备 Tauri 桌面壳骨架

## 当前限制

- 真实数据模式当前使用：
  - 新浪分页行情
  - BaoStock 行业映射
  - 新浪热门概念前 24 个
- 财务评分仍然以轻量代理指标为主，尚未接入完整财报字段
- Tauri 骨架已建立，但尚未完成首次正式桌面打包验证
- 第一次拉取 live 数据可能需要约 20-40 秒

## 下一步建议

1. 补完整财报字段，增强 Buffett 核心价值分真实性
2. 优化 live 数据抓取速度和缓存策略
3. 完成第一次 `npm run tauri:dev` / `tauri:build` 验证
4. 增加本地刷新日志和错误面板
5. 优化概念来源与行业摘要质量
