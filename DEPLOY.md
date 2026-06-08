# Scope 部署到 Render（免费）

## 一键部署步骤

1. 打开 https://render.com
2. 点击 **Get Started for Free**
3. 选择 **Sign in with GitHub**（用 roxyrhhg 账号登录）
4. 授权 Render 访问 GitHub 仓库
5. 在 Render Dashboard 点击 **New** → **Blueprint**
6. 选择 **RoxyRhHg/Scope** 仓库
7. Render 会自动检测 `render.yaml` 并创建服务
8. 点击 **Apply** 开始部署

## 部署后

- 服务地址：`https://scope-a-share.onrender.com`
- 手机直接用浏览器打开即可
- 每次 push 到 main 分支会自动重新部署

## 注意事项

- Render 免费版会在 15 分钟无请求后休眠，首次访问需要 30-60 秒唤醒
- 免费版每月 750 小时运行时间，足够个人使用
- 数据每天自动更新（AKShare 数据源）
