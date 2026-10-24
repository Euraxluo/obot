# Obot ZTOCC 主题改造状态

## 进度

- 已完成默认主题 token、DaisyUI light/dark 默认值、启动兜底色与圆角比例调整。
- 已完成 ZTOCC 默认 Logo/Icon/Favicon 替换，并保留 Branding 配置对 `--theme-*` 的覆盖机制。
- 已完成默认展示名与页面标题从 Obot 调整为 ZTOCC。
- 分支：`skin/ztocc-theme`。

## 变更文件

- 主题与默认偏好：`ui/user/src/app.css`、`ui/user/src/app.html`、`ui/user/src/lib/stores/appPreferences.svelte.ts`
- Logo 使用与尺寸：`ui/user/src/lib/components/Logo.svelte`、`ui/user/src/lib/components/navbar/BetaLogo.svelte`，以及使用默认 Logo 的少量页面样式类
- 静态品牌资源：`ui/user/static/user/images/ztocc/{ztocc-logo.png,drp-admin-logo.png,driver-app-logo.png,favicon.png}`
- Favicon/PWA/touch icon：`ui/user/static/favicon*`、`ui/user/static/apple-touch-icon.png`、`ui/user/static/android-chrome-*.png`
- 残留 Obot 蓝标直连引用：`ui/user/src/routes/admin/platform/LicenseView.svelte`、`ui/user/src/routes/privacy-policy/+page.svelte`、`ui/user/src/routes/terms-of-service/+page.svelte`
- 默认展示文案：`ui/user/messages/**/*.json`
- 测试 mock 默认值：`ui/user/src/tests/mocks/data.ts`

## 验收结果

- **verified**：默认 primary light=`#159a91`、dark=`#2dd4bf`；默认 UI 引用中已无 `#4f7ef3`。
- **verified**：默认 icon/error/warning 指向 `/user/images/ztocc/driver-app-logo.png`；light 全标指向 `ztocc-logo.png`；dark 全标指向 `drp-admin-logo.png`。
- **verified**：`favicon.ico` 含 16/32/48/64/128/256 六档；PNG favicon、apple touch icon、android chrome icon 均由 ZTOCC 方形品牌图生成。
- **verified**：`git diff --check` 通过。
- **blocked/skipped**：`pnpm install && pnpm run check` 未完成。原因：pnpm 自更新先被 `http://npm.ztosys.com` 502 阻断；绕过自更新后又受本机代理/registry 组合影响，依赖拉取长时间 0 进展。按纠偏要求停止继续探测并跳过 check。

## PR

- https://github.com/Euraxluo/obot/pull/1

## 下一步

1. 在 registry/代理恢复或可使用完整依赖缓存后运行 `cd ui/user && pnpm install && pnpm run check`。
2. 用真实页面检查 light/dark 首页、navbar、错误页、favicon 与 Branding 自定义覆盖路径。
