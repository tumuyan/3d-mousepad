# Agents.md — 3D MousePad Studio 协作规范

本文件记录本项目中用户与 AI 协作用的**统一术语**，避免后续沟通和代码改动时名词错位。

## 1. 术语对照表（用户视角 ↔ 代码）

| 用户视角术语 | 代码对应 | 说明 |
| --- | --- | --- |
| **鼠标垫外形 / 鼠标垫（模型）** | `padMesh`（`THREE.Mesh` + `ExtrudeGeometry(makeClassicShape())`） | 3D 场景中的鼠标垫顶面 / 侧面 / 底面，是用户看到的"鼠标垫"本体 |
| **控制曲线** | `drawCurveOverlay()` 中画出的**蓝色贝塞尔线** + **黑色锚点** + **橙色手柄方块** | 编辑模式下覆盖在 3D 场景上的可拖拽曲线 |
| **经典形状 / 经典款** | `P.shape === 'classic'`（下拉框中文标签 "经典"） | 鼠标垫外形采用经典贝塞尔变形的形状（用户明确：此模式叫"经典"，不叫 hug） |
| **圆角矩形** | `P.shape === 'rect'` | 默认 pad 形状 |
| **椭圆 / 胶囊形** | `P.shape === 'ellipse' / 'stadium'` | 其他可选形状 |
| **上半轮廓** | `makeClassicShape()` 中由 `classicCtrl` 贝塞尔链生成的部分 | 用户可拖动锚点 / 手柄改动的部分 |
| **下半轮廓 / 腕托足迹** | `makeClassicShape()` 中由 `bottomPts`（腕托包裹足迹）生成的部分 | 由参数 `wMargin / wPos / wD / wristStyle` 等控制，**不接受控制点拖拽** |
| **腕托 cushion** | `wristGroup`（`SphereGeometry` 缩放的椭球） | 鼠标垫上方的软垫可视化，**编辑模式也始终显示**（呈现真实渲染状况），覆盖层（曲线/锚点）绘制在 3D 之上仍可拖拽 |
| **编辑模式 / 编辑轮廓** | `curveEdit = true` | 经典形状的"鼠标垫外形"选项组内**第二项**，复选框"编辑轮廓（拖拽贝塞尔控制点）"，**默认不勾选** |
| **正交相机** | `orthoCam`（`OrthographicCamera`） | 编辑模式专用相机，与 `renderer.render` 共用；`shapeToScreen` 也用此相机投影 shape 边界到屏幕 |
| **配置导出 / 导入** | `serializeConfig(withTextures)` / `importConfigFile(file)` | 把 `P`（参数）序列化进 `config.json`（ZIP 内）；`withTextures=true` 时额外把 `P.t1/P.t2` 贴图以 `tex1.*`/`tex2.*` 打包进 ZIP。`importConfigFile` 支持 `.json` 与 `.zip` 两种格式 |
| **ZIP 打包 / 解包** | `makeZip(files)` / `parseZip(u8)`（含 `crc32`） | 纯前端用 `CompressionStream`/`DecompressionStream` 实现，无第三方依赖；文件头存 `config.json` + 可选 `tex1.*`/`tex2.*` |
| **贴图拖拽区预览** | `setDZPreview(dz, url, onClear)`（DOM 元素，非字符串） | 在 `#dz1`/`#dz2` 显示已上传贴图的缩略图与清除按钮；第一个参数必须是 DOM 元素（`getElementById('dz1')`），传字符串会 `innerHTML` 报错 |
| **贴图加载** | `makeTex(url, cb)` | 第二个参数是**加载完成回调 `cb(t)`**，不是变换参数；误把 `P.t1` 当第二参会导致 `cb is not a function` |

## 2. 关键代码定位
- `makeClassicShape()` — 生成经典形状的完整 `THREE.Shape`，上半贝塞尔 + 下半足迹折线
- `setEditOrtho()` — 计算正交视锥：`L/R/T/B` 基于 `makeClassicShape()` 真实 bbox，中心对齐 shape 几何中心
- `shapeToScreen(shapeX, shapeY)` — 把 shape 2D 坐标投影到屏幕像素，矩阵来源与 3D 渲染相同
- `drawCurveOverlay()` — 编辑模式下在 `curveLayer` 画蓝色控制曲线（投影 `makeClassicShape` 完整轮廓）+ 锚点/手柄
- `buildPad()` — `P.shape === 'classic'` 时调用 `makeClassicShape()` 构建 `padMesh`（编辑态也保留倒角 `bevelEnabled: P.bevel>0`，顶面在世界 Y = `P.thick/2 + P.bevel`）
- `buildWrist(topY)` — 构建腕托 cushion，**始终 `wristGroup.visible = true`**（编辑模式也显示，以呈现真实渲染）
- `setCurveEdit(on)` — 进入/退出编辑模式，切换 `curveEdit`、正交相机渲染、`controls.enabled`、覆盖层显示（不再控制腕托显隐）
- `classicCtrl`（即 `P.classicCtrl`）— 上半贝塞尔锚点链数组，结构 `[{ x, y, h1:{x,y}, h2:{x,y}, pin?:true }]`。⚠️**运行时坐标一律用顶层 `{x,y,h1,h2}`**（与 `bakeClassicCtrl`/`makeClassicShape` 约定一致），**不要写成 `{p:{x,y}, h1, h2}` 嵌套**——后者是旧版导出格式，会被 `ensureClassicCtrl` 判为无效而退回程序化默认。首尾两点为 `pin`（接缝，切线由 `ensureClassicCtrl` 平移并重算），中间锚点可拖拽
- `DEFAULT_CLASSIC_CTRL` — 默认锚点常量（脚本靠前定义），存当前"出厂默认外形"的锚点链（当前取自 `3d_MousePad_Template`）。`P.classicCtrl` 默认 = `structuredClone(DEFAULT_CLASSIC_CTRL)`；`重置锚点` 按钮也恢复到它。⚠️**锚点数量不固定**（取决于设计稿：典型为若干可拖拽中间点 + 首尾 `pin` 接缝点），不要假设或硬编码具体点数；改默认外形时直接整段复制设计稿的锚点 `x/y/h1/h2` 进此常量，**不要自创或增减点**（曾因自创多余接缝点导致默认样式与设计稿不符）
- `bakeClassicCtrl` / `ensureClassicCtrl` / `autoSmoothClassicCtrl` — 锚点链的烘焙 / 复用 / 平滑函数
- `norm2(x,y)` — **全局工具函数**（脚本靠前定义），返回归一化单位向量；`bakeClassicCtrl` / `ensureClassicCtrl` 的端点切线计算均依赖它
- **经典形状端点切线（G1）**：`makeClassicShape()` 中 `dBLv` / `dBRv` 统一取"离开端点沿底轮廓向内"的方向（右→左），由 `bakeClassicCtrl` 取 `-dBLv` / `-dBRv` 作为两端贝塞尔手柄方向，保证左右下角关于竖直中轴**镜像对称、圆润衔接**。注意 `dBLv` 须用 `bottomPts[n-2] - pBL`（离开方向），误用 `pBL - bottomPts[n-2]`（进入方向）会导致一侧端点切线反向、出现折痕
- `importConfigFile(file)` — 解析 `.json`/`.zip`，`Object.assign(P, cfg.params)` 恢复参数；随后必须调用 `rebuild()` + `refreshShapeUI()` + `refreshWristUI()` + `uiSyncers.forEach(f=>f())` + `syncTexUI('t1'/'t2')` 同步全部 UI 显隐与控件值
- `uiSyncers` — **全局控件值同步器数组**：每个 `slider/colorRow/selectRow/checkRow` 注册一个把 `inp.value = get()` 的闭包；导入后遍历即可刷新所有滑条/下拉/复选框的数值，但**不负责显隐**
- `refreshShapeUI()`（形状分组显隐）— 根据 `P.shape === 'classic'` 切换 `classicRows` / `nonClassicRows` 的 `.row` 显隐；导入时已调用 ✅
- `refreshWristUI()`（腕托分组显隐）— 根据 `P.wristStyle`（none/full/balls）切换 `腕托宽度`/`肾形程度`/`单球宽度`/`双球旋转` 等行的显隐；导入时必须显式调用（曾漏掉导致款式切了但控件不显隐）
- `colorRow()` **必须 `return row`**：`边缘同色` 勾选时隐藏的 `边缘颜色` 行依赖 `colorRow` 返回值；若漏写 `return row` 则 `edgeColorRow` 恒为 `undefined`、显隐完全失效（含导入后恢复）

## 3. 视觉一致性原则
- 蓝色控制曲线 = `makeClassicShape()` 完整投影 = `padMesh` 顶面 = 鼠标垫 3D 渲染外形，三者**严格 1:1 重合**（数学保证：同一相机同一矩阵同一 shape；顶面边界即 shape 边界，开启倒角后轮廓仍对齐，`shapeTopY()` 已含 `+P.bevel`）
- 鼠标垫颜色（材质色、贴图）由 `P.t1 / P.t2 / P.baseColor / P.padColor` 等参数控制；为方便调试，用户已指示将鼠标垫**整体着色为黄色**，与蓝色控制曲线形成高对比
- 编辑模式下也显示腕托 cushion、保留立体倒角，以呈现实际渲染状况（鼠标垫立体外观、腕托凸起、光照/贴图）；蓝色轮廓覆盖层始终绘制在 3D 之上，拖拽编辑不受影响
- 腕托与倒角在所有模式下均显示，不存在"退出编辑才出现"的状态

## 4. 修改/调试注意事项
- **不要**在浏览器跑老版本 JS 后判定 bug；项目已加 `<meta http-equiv="Cache-Control" content="no-cache">`，但用户硬刷新（Ctrl+Shift+R）才能确保拿到最新代码
- **不要**把 `padMesh` 顶面与 `wristGroup` cushion 混淆；cushion 是 `SphereGeometry`，顶面 `padMesh` 是 `ExtrudeGeometry`，**两个独立对象**
- 修改 `setEditOrtho` 后需要让 `rebuild()` / `resize()` / 用户操作触发重新计算，否则视锥用旧值
- `shapeToScreen` 与 `renderer.render(scene, orthoCam)` 始终用同一 `orthoCam` 对象，保证 1:1
- 经典形状模式在代码中用英文值 `'classic'`，**不要使用 `hug`**（用户要求此模式叫"经典"）
- `norm2(x,y)` 是**全局函数**（脚本靠前 `const norm2 = ...`）；任何需要归一化方向向量的代码都应复用它，不要重复定义局部版本（曾因在 `bakeClassicCtrl` 内重复定义、而他处引用不到导致 `ReferenceError: norm2 is not defined` 使 `rebuild()` 崩溃、页面全黑）
- **经典模式 UI 选项约定**：`宽度` / `圆角` 滑条归入 `nonClassicRows`，经典模式自动隐藏（经典款由腕托足迹 + 贝塞尔锚点决定，这两个参数无效）；"编辑轮廓（拖拽贝塞尔控制点）"在"鼠标垫外形"组内为**第二项、默认不勾选**；`P.edgeSame` 默认 `true`（边缘同色勾选）
- 经典模式"鼠标垫外形"选项组顺序：`腕托顶距` → `编辑轮廓` → `外形超出腕托`（三项）。**`编辑轮廓` 行右侧直接挂一个 `重置锚点` 按钮**（不再有独立的"轮廓锚点/重置为默认形状"行）；点击把 `P.classicCtrl` 重置为 `DEFAULT_CLASSIC_CTRL` 并 `refreshShapeUI() + rebuild()`。`checkRow` 已被改为返回 row 元素（而非 input），以便在该行内 `appendChild` 按钮
- **导入配置后 UI 同步约定**：任何"依赖 `P` 值决定控件显隐/可见性"的逻辑，必须能在导入路径上被触发。`uiSyncers` 只同步**数值**（`inp.value`），不处理显隐。当前导入函数已统一调用 `refreshShapeUI()` + `refreshWristUI()` + `uiSyncers.forEach` + `syncTexUI`；若新增"根据某参数隐藏某行"的逻辑，要么挂进对应的 `refreshXxxUI()`（导入已调用），要么 push 进 `uiSyncers` 里做显隐。**曾因漏调 `refreshWristUI` 导致导入后款式切了但同组控件不显隐，以及 `colorRow` 漏 `return row` 导致边缘颜色行永远无法隐藏/恢复**
- **贴图导入调用签名**：`makeTex(url, cb)`（cb 为回调，非变换参数）；`setDZPreview(dz, url, onClear)` 的 `dz` 必须是 DOM 元素（`getElementById('dz1')`），二者传错类型会分别报 `cb is not a function` / `Cannot create property 'innerHTML' on string`
- **`ensureClassicCtrl` 的 stale 判断**：只要求每个点 `x/y` 有限；若某点"部分有手柄"（`p.h1||p.h2` 但缺其一）才判无效。中间接缝锚点可**完全无 `h1/h2`**（合法），返回前会由 `ensureClassicCtrl` 自动补一对平滑共线手柄，避免 `makeClassicShape()` 的贝塞尔链读到 `undefined` 手柄。**曾误判"无 h 的点"为 stale 而退回程序化默认形状**，导致默认外形不符设计稿
- **经典轮廓导入兼容**：`importConfigFile` 已兼容旧版 `{p:{x,y}, h1, h2}` 嵌套格式（自动提升为顶层 `{x,y,h1,h2}`）。但优先保持运行时顶层格式；导入任何顶层格式的设计稿后，其外形应与默认外形（同一 `DEFAULT_CLASSIC_CTRL`）一致

## 5. 仓库结构
```
index.html       主程序（纯前端单文件，Three.js 经 importmap 从 CDN 加载，无需构建）
server.js        本地静态服务器：node server.js [端口默认5213]
README.md        项目说明与运行方式
package.json     （可选）仅声明 playwright 等调试用依赖；运行项目不依赖 npm 包
package-lock.json （可选）npm 锁文件
Agents.md        本协作规范
.gitignore       
```
- 运行项目**不需要** `node_modules`：`index.html` 通过 CDN 加载 Three.js，直接浏览器打开或 `npx serve .` 即可
- `package.json` / `package-lock.json` 仅用于需要时 `npm i` 安装 playwright 做调试验证，非运行依赖
- `snap*.yaml`、`*_diag*`、`*.png`、`server.log` 等为调试产物，已纳入 `.gitignore` 不应提交
