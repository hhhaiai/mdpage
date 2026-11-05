# Markdown 小助手

纯前端 Markdown 编辑、实时预览与导出工具，不需要后端。同一份代码、同一个 `dist/` 可部署到 GitHub Pages、Cloudflare Pages 或 Cloudflare Workers Static Assets。

构建和 Cloudflare CLI 要求 **Node.js 22 或更高版本**；仓库的 `.nvmrc` 将自动构建统一为 Node.js 22。页面渲染和导出仍需联网加载现有 CDN 依赖。

## 一键上传 Markdown 图片

点击右上角 **图片上传CDN**，将当前 Markdown 中的网络图片或 Base64 图片通过 [imgtool API](https://github.com/hhhaiai/imgtool/blob/main/worker/API.md) 上传至百度 CDN。面板显示真实的“已完成 / 总图片数”和当前处理状态，可随时取消；进度按图片计数，不伪造字节百分比。

- 相同地址只上传一次，并更新所有对应图片。已是百度 CDN 的图片不重复上传。
- 保留图片说明、MWeb 宽度、标题及其他文本；支持行内图片、引用式图片、表格/引用/脚注中的图片、HTML `img src` 和 `[[img:...]]`。代码示例、普通链接不改；引用式图片会转换为行内语法，不修改共用的引用定义。
- **全部候选成功后才一次性替换链接**，可用编辑器撤销恢复。上传期间编辑器临时只读；若其他操作改变文档，则停止并保留新编辑，不覆盖。失败或取消时不替换任何链接；本页内已确认成功的结果可复用，避免重复上传。
- 相对路径、本机文件、内网地址、SVG Data URL 等不支持的来源会明确跳过。浏览器不能凭 Markdown 中的文件路径直接读取硬盘；HTML `srcset` 和绘图块内资源不在本功能范围内。
- 点击即表示将这些图片或图片地址交给 imgtool / 百度；**不发送 Markdown 正文**，也不发送浏览器凭据。已发出的上传无法撤回，请勿用于敏感或无权公开的图片。CDN 地址的有效期和可用性由上游服务决定，不作为永久存档保证。

当前调用 `https://upload.example.com/api/upload`，每批最多 100 张不同图片，单张按服务默认 5 MiB 限制；远程下载失败、鉴权变化或限流会显示错误，不进行自动重复上传。文档过大时请分批处理。完成后点击 **保存.md** 下载更新后的文档。

## 粘贴不同来源的 Markdown

有标题就会生成右上角悬浮目录，可折叠、点击跳转并跟随滚动高亮。分屏和手机上默认收起，预览模式在空间足够时展开。需要在正文中也放目录时，单独一行写 `[TOC]`、`[[toc]]` 或 `[[_TOC_]]`（不区分大小写）。

| 场景 | 支持的写法 |
| --- | --- |
| 标题锚点、目录排除 | `## 标题 {#custom-id}`、`## 不进目录 {.no_toc}`，也支持 Setext 标题 |
| GitHub / Obsidian 提示块 | `> [!NOTE]`、`> [!TIP] 标题`、`> [!WARNING]` 等；`> [!TIP]- 标题` 默认折叠，`+` 默认展开 |
| 文档提示容器 | `::: info`、`::: tip`、`::: warning`、`::: danger` 等，结尾 `:::` |
| 折叠内容 | `::: details 标题`、`::: collapse 标题` 和原生 HTML `<details>` |
| 高亮、上下标、插入与删除 | `==高亮==`、`H~2~O`、`x^2^`、`++插入++`、`~~删除~~` |
| 术语、缩写 | `术语` 下一行 `: 释义`；`*[HTML]: 完整名称` 定义悬浮提示 |
| MWeb 图片宽度 | `![图片描述-w140](图片地址)`，按像素设置宽度，仍限制在预览区内 |
| 元数据 | 文件开头的 YAML `---` 或 TOML `+++` 块；折叠展示原文，不执行配置 |
| 公式 | `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 及 `math` 代码块；代码示例不当公式解析 |
| 图表 | Mermaid、旧式 `sequence` / `flow`、ECharts、Graphviz/DOT、draw.io XML（含压缩与多页） |
| 其他已有功能 | 表格与对齐、任务列表、脚注、emoji、代码高亮、自动链接、保存 `.md`、导出 Word |

例如：

```markdown
[TOC]

## 开始 {#start}

> [!TIP] 提示
> 支持 **Markdown**、==高亮== 和 $x^2$。

> [!WARNING]- 点击展开
> 这是默认折叠的注意事项。
```

**兼容边界：**这是常见扩展的组合，不代表完整模拟 MWeb、GitHub、Obsidian、Typora 或 Pandoc。跨文件 `[[双链]]`、`![[嵌入]]`、MDX/JSX、Dataview、任意站点 shortcode 和复杂合并单元格暂不解析。不执行原文脚本、事件、iframe 或页面级样式；任务勾选状态由源文档控制。MWeb 可选的双反引号行内公式仍按代码显示，避免把普通代码误当数学。悬浮目录不进入 Word，正文目录按普通列表导出，不能当作 Word 自动更新目录；导出后的复杂样式与交互不保证与网页一致。

实现语法参考：[GitLab 目录标记](https://docs.gitlab.com/user/markdown/#table-of-contents)、[VitePress 扩展](https://vitepress.dev/guide/markdown)、[Obsidian Callouts](https://obsidian.md/help/callouts) 及 [markdown-it 插件](https://github.com/markdown-it)。

## 插入图表

所有图表都写在代码围栏中。依赖库按需从固定版本 CDN 加载，图表内容在浏览器本地渲染，不发送到第三方渲染服务器；失败时显示原因并保留原始语法，不把代码块伪装成渲染成功。

| 格式 | 围栏语言 | 用途及边界 |
| --- | --- | --- |
| Mermaid | `mermaid` | 流程、时序、甘特、类图、ER、状态、思维导图等；以固定 Mermaid 10.9 的支持范围为准 |
| ECharts | `echarts` | 柱状、折线、饼、散点等；JSON/JSON5 或 MWeb 的 `option = {...};` 数据对象 |
| Graphviz | `dot` / `graphviz` | DOT 有向/无向结构图；本地 Worker 渲染，15 秒超时，不加载图片或可点击外链 |
| draw.io | `drawio` / `draw.io` / `mxgraph` | 粘贴 `.drawio` 文件的 XML；支持原生 `<mxGraphModel>`、`<mxfile>` 子节点、转义内容、压缩页和多页。多页按原顺序逐页显示 |
| PlantUML | `plantuml` / `puml` | 识别并提示暂不渲染；不自动上传公共 PlantUML 服务，可先导出图片后插入 |

MWeb 风格的统计图示例：

```echarts
option = {
  xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
  yAxis: { type: 'value' },
  series: [{ data: [12, 18, 15], type: 'bar' }]
};
```

结构图示例：

```dot
digraph {
  rankdir=LR;
  编辑 -> 预览 -> 导出;
}
```

ECharts 不执行回调函数、变量引用或 JavaScript 表达式；高级需要执行代码的配置应先改成静态数据。安全预览禁用外链、外部图片、HTML 数据视图及正则过滤，tooltip 固定为 `richText`。图表最多 20 个/文档；ECharts 配置上限 500 KB，DOT 上限 100 KB。draw.io 上限 30 页、原文/单页解压内容 4 MB、页面总内容 8 MB。

ECharts、Graphviz 和 draw.io 会作为图片导出到 Word，导出前等待图表完成；失败的图表会阻止导出，避免静默丢图。原始配置仍保留在保存的 Markdown 中。浏览器不能直接读取 MWeb 附件目录里的本地图片或 `.drawio` 路径，需要粘贴 XML 或使用可访问的图片地址。

依据：[MWeb 官方语法](https://zh.mweb.im/zh-markdown)、[draw.io 文件结构](https://www.drawio.com/docs/reference/diagram-generation/)、[ECharts 安全指南](https://echarts.apache.org/handbook/en/best-practices/security/)、[Viz.js API](https://viz-js.com/api/)。

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
