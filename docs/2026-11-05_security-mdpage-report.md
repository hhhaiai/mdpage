# Markdown 小助手安全、性能与稳定性审查

日期：2026-11-05。范围：当前仓库的静态网页、Markdown 扩展、图表与图片上传、Word 导出、构建脚本、依赖和 GitHub Pages 发布配置。未审计上传服务后端、未发送真实图片，也未测试未获授权的其他站点。

## 结论与边界

本轮发现的可复现高风险代码路径已修复，并经过自动测试、独立复核与真实 Chrome 验证；这不代表不存在未知漏洞。纯静态页面没有账号、数据库或业务服务端。主要边界是粘贴的 Markdown/XML/图表配置，以及执行这些内容的第三方浏览器库。

上传接口不再内置个人地址，改为本页内存输入，不写 localStorage/sessionStorage。浏览器运行时的请求地址仍对使用者可见，不能用前端混淆保护密钥。点击上传会把候选图片或图片 URL 交给所填接口及百度，已经发出的请求不能撤回。

## 证据、发现与处置

| 证据 → 发现 | 原影响 | 代码路径与修复 | 验证 |
| --- | --- | --- | --- |
| 含 `mxStylesheet` 的 XML 可进入 mxCodec 求值，而不是普通 HTML 清洗 | 粘贴 draw.io 内容可能执行脚本 | `js/diagram-renderer.js` 只接收模型结构白名单，禁止任意 codec/include/原型绑定；`js/app.js` 关闭 mxStylesheetCodec/mxObjectCodec 的 allowEval | 原生、压缩、多页正常模型与恶意 codec 测试；Chrome 正常图可见、恶意模型报错且无执行 |
| Mermaid 配置能设置 CSS，移除 foreignObject 又会丢失默认 HTML 标签 | 外部资源/样式边界与视觉回归 | 固定 Mermaid 10.9.8，保留 secure 默认项并锁定主题、CSS、HTML 标签与清洗配置；改用 SVG 文本后再清洗 | Chrome 节点 Start/Finish 可见，无 foreignObject，配置注入未触发外部资源请求 |
| 导出在等待依赖/图表时可能混入新内容，图片/公式失败会被跳过 | 文档错版、缺图、残留离屏节点 | 锁定原文快照、刷新最后输入、异步阶段检查版本；失败关闭；finally 恢复界面与移除 sandbox | 导出竞态、失败清理测试；真实冷加载公式/四类图表导出成功 |
| 网络图片只有 MIME 判断、Data URL 可含坏字节 | 导出损坏图片仍可报告成功 | 图片预读取、解码检查、格式/字节/像素/总量限制；CORS 和下载超时失败明确停止 | 坏图、本地图、网络失败测试；真实 DOCX 包结构检查 |
| 列表递归先拼文本再拼子列表、任务勾选和超链接信息不完整 | Word 内容结构失真 | 按子节点顺序分段递归，保留编号起点、深度、任务状态与外链 | 嵌套列表前后段落顺序与 Word XML 检查 |
| 未闭合公式反复扫描、重复 ID 从 1 重试、每个 TOC 复制全部标题 | 小输入放大为长时间主线程阻塞 | 缓存未闭合公式终点、ID 后缀游标、TOC 数量和条目预算；原文相同不重绘 | 8000 行未闭合公式、4000 重复标题、100 个 TOC 回归 |
| 大型 ECharts 配置、图表和导出 canvas 缺预算 | 卡顿、内存放大和超大像素分配 | 图表数据/复杂系列/数量限制；Graphviz Worker 超时取消；导出栅格尺寸上限、回调异常处理、计时器清理 | 超量饼图、数组、巨大 SVG 拒绝测试 |
| 构建输出可指向源码/父目录，公开输入可以是符号链接 | 本地文件误删或把外部文件打包公开 | 规范化路径；项目内仅 dist；项目外只允许空/新目录；输入递归拒绝链接、特殊/隐藏文件 | 隔离 fixture 测试父目录、项目根、.git、源码等标记完整保留 |
| 个人上传/托管地址进入源码与旧构建产物 | 项目副本公开传播地址 | 源码改为运行时配置，文档脱敏；备份使用加密而不是明文旧副本 | 当前源码扫描无已登记个人地址；历史及发布制品另行清理 |

## 可复现验证

在仓库根目录使用 Node.js 22 或更高版本：

```bash
npm ci
npm test
npm run build
npm audit --registry=https://registry.npmjs.org
```

- 自动测试：66/66 通过，包括构建、解析、危险 XML、导出一致性和性能边界；JS 语法检查、`git diff --check` 通过。
- Chrome：桌面 1440×1000、手机 390×844；检查目录、空接口提示、无持久化、四类图表、安全输入拦截和冷加载 Word 导出。
- 导出 DOCX：ZIP 完整；7 个内嵌图片，勾选状态、外链与 Outer → Inner → After nested → Next 顺序正确。只核验包结构，不声称已在所有 Word/WPS/Pages 版本逐页验收。
- Cloudflare Workers/Pages 本地真实运行过；静态文件可访问，Workers 返回已配置安全头。不代表 Cloudflare 生产环境已重新部署。
- 供应链：原锁文件 4 个 high，Wrangler 升级为 4.157.0 后，官方 npm registry 对项目锁文件审计为 0。默认镜像 registry 不支持 audit，因此未把其失败当作无漏洞。

## 仍需关注的风险与优化空间

1. **浏览器 CDN 不在项目锁文件审计中。** 已额外建立隔离清单审计运行时库并升级 Mermaid/KaTeX。Mermaid 10.9.8 的依赖树仍报告旧 KaTeX/uuid 的低或中等级公告，mxGraph 4.2.2 仍有无修复版本的 tooltip 公告；当前初始化固定配置、禁 tooltip/求值并清洗输出，未在本次路径复现剩余利用。不能因此称所有运行时依赖零漏洞。后续替换老 mxGraph、升级 Mermaid 主版本应作为独立兼容项目，不在本轮盲目替换。
2. **第三方脚本信任与网络可用性。** CDN 固定版本但尚未全面自托管/SRI；供应商故障或被篡改仍影响页面。优先后续把浏览器依赖纳入构建并自托管，配合兼容 GitHub Pages 的 CSP。严格 CSP 当前会影响内联事件、图形库及懒加载，不直接强上导致功能失效。
3. **普通 Markdown 远程图片可产生请求。** 预览图片可能向图片提供者暴露 IP，导出会取图；页面已设置 no-referrer，但这不等于离线隐私模式。不要粘贴不可信或包含敏感远程资源的文档。
4. **超长文档与压缩图仍非无限预算。** 主线程 Markdown/Math/Mermaid/mxGraph 的计算并非全部可中断。当前预算降低明显放大路径，未来可在确有大文档需求时增加 Worker 解析/分段渲染。图片扫描为位置映射使用逐字符数组，16 MB 上限附近内存仍偏高，可另做稀疏映射优化。
5. **上传后端未在范围内。** HTTPS/公网主机校验不能替代服务端 DNS 重绑定、下载重定向/内网拦截、限流和鉴权。上传服务需单独审核。静态页面不应携带后台密钥。
6. **部署管道改进。** Actions 固定大版本而非 commit SHA；可后续锁 SHA 并配置自动依赖更新。遗留 `Jenkinsfile.github` 内容语法异常且依赖外部共享库，本项目工作流未使用，未尝试执行或修改外部 Jenkins 配置。

## 隐私清理的验收边界

当前可控的源码、Git 可达历史、Actions 记录/制品和发布内容需要分别核验；仅删除最新文件不能消除旧历史。历史重写会改变提交 ID，旧克隆不应合并旧历史回来，建议重新克隆。旧截图/克隆、搜索索引及 GitHub 无引用对象或缓存不受本地垃圾回收控制；必要时由 GitHub Support 按其政策处理，不承诺全网彻底擦除。

外部依据：[GitHub 历史清理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)、[Mermaid secure 配置](https://mermaid.js.org/config/schema-docs/config-properties-secure.html)、[Mermaid 配置修复公告](https://github.com/mermaid-js/mermaid/security/advisories/GHSA-c4c3-pg64-4m4v)、[KaTeX 公告](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)、[mxGraph 公告](https://github.com/advisories/GHSA-j4rv-pr9g-q8jv)。公告与审计结论以本报告日期为准。
