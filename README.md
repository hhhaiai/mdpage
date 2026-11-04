# Markdown 小助手

纯前端 Markdown 编辑、实时预览与导出工具，不需要后端。同一份代码、同一个 `dist/` 可部署到 GitHub Pages、Cloudflare Pages 或 Cloudflare Workers Static Assets。

构建和 Cloudflare CLI 要求 **Node.js 22 或更高版本**；仓库的 `.nvmrc` 将自动构建统一为 Node.js 22。页面渲染和导出仍需联网加载现有 CDN 依赖。

## 部署到 GitHub Pages

1. 将代码推送到 GitHub 仓库的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
3. 在 **Actions → Deploy static site to GitHub Pages** 中选择 **Run workflow** 启动首次部署。之后每次推送到 `main` 都会自动测试、构建和发布。

工作流使用仓库自带的 `GITHUB_TOKEN`，无需配置个人访问令牌。部署成功后的地址显示在工作流的 `github-pages` environment 中；本仓库对应的项目站点路径为 `https://upload.example.com/mdpage/`，实际可用性以部署结果为准。

本地 CSS、JS 和图标使用相对路径，兼容 `/mdpage/`、Fork 后的新仓库路径和自定义域名根路径，不必修改 base URL。`.nojekyll` 可用于普通静态发布；Actions 工作流直接上传构建产物，不经过 Jekyll。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 部署到 Cloudflare Pages

在 Cloudflare **Workers & Pages → Create application → Pages → Import an existing Git repository** 中选择本仓库，使用以下配置：

| 配置项 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 留空（仓库根目录） |

不需要修改 Workers 的 `wrangler.jsonc`，也不要给 Pages 填写 `npm run deploy`。Pages 会托管构建输出，后续推送到 `main` 自动更新生产站点。

参考：[Cloudflare 静态 HTML 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/) 和 [构建 Node 版本配置](https://developers.cloudflare.com/pages/configuration/build-image/)。

## 部署到 Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://example.com/project/tree/main)

将代码推送到公开 GitHub 仓库后，可通过上方按钮复制仓库并在自己的账号下部署。按钮使用 **Workers Static Assets**，不是 Cloudflare Pages；Cloudflare 会识别 `build` / `deploy` 脚本，静态资源目录由 `wrangler.jsonc` 的 `assets.directory = "./dist"` 指定。

也可以在 Cloudflare Workers 中导入仓库，使用构建命令 `npm run build`、部署命令 `npm run deploy`。现有 Worker 名称为 `simimd`；如果账号中已有同名项目，请先修改 `wrangler.jsonc` 的 `name`，避免覆盖。

参考：[Deploy to Cloudflare 按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/) 和 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)。

## 本地运行

```bash
npm ci
npm run dev
```

`npm run dev` 构建 `dist/` 并启动本地 Workers 静态服务器；如需验证 Pages 环境，运行 `npm run dev:pages`。仅构建和检查时运行 `npm test && npm run build`。

## Cloudflare 命令行部署

安装依赖后，先用 `npx wrangler login` 登录自己的 Cloudflare 账号，再执行 `npm run deploy` 发布 Workers 静态站点。

`npm run deploy:pages` 面向已创建的 `simimd` Pages 项目、生产分支 `main`。使用前须确认账号和项目归属；若名称不同，修改 `package.json` 中该命令的 `--project-name` 和 `--branch`。

## 构建产物与平台差异

构建仅复制站点必需文件，不会发布工作流、源码测试、依赖目录或本地环境变量。`dist/`、`node_modules/` 和 `.wrangler/` 已排除出 Git。

- `index.html`、`css/`、`js/`、`imgage/`：入口和静态资源。
- `.nojekyll`：普通 GitHub Pages 静态发布标记。
- `_headers`：Cloudflare 响应安全头与缓存策略。
- `_redirects`：Cloudflare 将旧入口 `/md.html` 永久重定向到 `/`。

GitHub Pages 不执行 `_headers` 和 `_redirects`；请使用首页地址，不依赖 Cloudflare 的旧入口重定向。两个平台可以同时启用，各自托管同一份构建结果。
