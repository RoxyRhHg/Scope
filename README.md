# Scope Buffett A股筛选 MVP

## 启动

最省事的方式：

- 双击当前目录里的 `启动Scope.vbs`
- 如果你想看到脚本窗口，也可以双击 `启动Scope.cmd`
- 停止服务时双击 `停止Scope.vbs` 或 `停止Scope.cmd`

命令行方式：

```bash
npm test
npm start
```

启动后打开：

```text
http://127.0.0.1:4173/
```

如果要以桌面程序方式运行：

```bash
npm run tauri:dev
```

## 当前状态

- 当前优先使用 `真实 A 股快照`
- 真实数据链路：
  - 新浪分页行情
  - BaoStock 行业映射
  - 新浪热门概念前 24 个
- 若 live 抓取失败，会自动回退到 `样例数据模式`
- 已实现 Buffett 主评分、主题辅助排序、资金适配修正
- 已实现全市场 Top 50、行业 Top 20、重点关注 1-2 只
- 已实现手动刷新、每小时自动刷新逻辑、权重与资金量调节
- 个股详细卡片已加入：
  - MACD
  - BOLL
  - KDJ
  - 成交量放缩分析
  - 综合多空技术判断
- 已建立 Tauri 桌面壳骨架

## 环境

- Node / npm
- Python 3.9
- Rust + Cargo
- Visual Studio Build Tools 2022
- WebView2

可以用下面命令自检：

```bash
cmd /c "set PATH=%USERPROFILE%\.cargo\bin;%PATH%&& npx tauri info"
```

## 目录

- `public/`：前端页面
- `src/core/`：筛选、评分、样例数据、真实数据适配和页面模型
- `src/server.js`：本地静态服务
- `scripts/fetch_live_snapshot.py`：真实数据抓取脚本
- `scripts/fetch_stock_history.py`：个股历史 K 线抓取脚本
- `src-tauri/`：Tauri 桌面壳
- `tests/`：排序和过滤测试
- `task.md`：当前进度与下一步

## 说明

当前项目已经补齐 Rust/Tauri 基础环境，并接入真实数据通路。  
如果你在自己的终端里运行，`/api/dashboard` 会优先返回 live 模式真实快照；如果某一条数据源失败，界面会自动回退到样例模式，不会直接空白。
