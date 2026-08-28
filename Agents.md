# Agents.md — 3D MousePad Studio 协作规范

本文件记录本项目中用户与 AI 协作用的**统一术语**，避免后续沟通和代码改动时名词错位。

## 1. 术语对照表（用户视角 ↔ 代码）

| 用户视角术语 | 代码对应 | 说明 |
| --- | --- | --- |
| **鼠标垫外形 / 鼠标垫（模型）** | `padMesh`（`THREE.Mesh` + `ExtrudeGeometry(makeClassicShape())`） | 3D 场景中的鼠标垫顶面 / 侧面 / 底面，是用户看到的"鼠标垫"本体 |
| **控制点叠加层** | `drawCurveOverlay()` 中画出的**黑色锚点圆**（描边 `#4da3ff`）+ **橙色手柄方块**（`#ff7a59`，hover 变 `#ffd166`）+ 手柄连线（`#6b7480`） | 编辑模式下覆盖在 3D 场景上的可拖拽控制点。⚠️**不画轮廓线**：轮廓外形直接看 3D 渲染结果（2026-08-28 用户决定：只需操作锚点，用渲染效果判断外观） |
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
| **剪贴板粘贴按钮** | `#paste1` / `#paste2`（`.paste-btn`） | 位于左侧贴图区每行最左、与右侧 dropzone 等高的 `📋` 小方块。点击调用 `navigator.clipboard.read()` 主动读取剪贴板图片，分别填入 `tex1`/`tex2`。按钮在 `.dz-wrap` 内、作为 dropzone 的**兄弟节点**（非子节点），不受 `setDZPreview`/`resetDZ` 的 `innerHTML` 重写影响，**常驻显示**（上传/清除后不消失） |
| **Toast 提示** | `toast(msg, type, ms)` | 轻量非阻塞提示，替代 `alert()`。`type` 为 `''`/`'ok'`/`'err'`：`err` 显示为红字，其余普通浅色文字，边框统一无特殊设计（不再用绿/红边）。底部居中淡入、`ms` 毫秒后（默认 2600）点击或超时自动淡出移除。所有用户反馈（导入成功/失败、剪贴板错误等）统一走 toast，**禁止新增 `alert()`** |

## 2. 关键代码定位
- `makeClassicShape()` — 生成经典形状的完整 `THREE.Shape`，上半贝塞尔 + 下半足迹折线
- `wristFootprint(kind, opts)` — 采样腕托「原始足迹」折线（右→左）。⚠️ 变换链必须与 3D 腕托**逐字一致**：单位球 → 变形 → 按半轴缩放 → 绕 y 轴旋转（`noRot=true` 可忽略旋转角）。`kind==='full'` 时弧段起点用 `t0 = atan2(ry*s, rx*c)`，保证两端接缝落在旋转后轮廓的最宽点
- `buildFootprint(out, noRot)` — 生成一段完整足迹（含 `wMargin` 外扩）写入 `out`。`makeClassicShape()` 调两次：`noRot=false` 出真实轮廓，`noRot=true` 出**旋转无关的布局基准**（垫身总长 `padH` + 腕托 z 基准 `classicZBaseCache`）
- `setEditOrtho()` — 计算正交视锥：`L/R/T/B` 基于 `makeClassicShape()` 真实 bbox，中心对齐 shape 几何中心
- `shapeToScreen(shapeX, shapeY)` — 把 shape 2D 坐标投影到屏幕像素，矩阵来源与 3D 渲染相同
- `drawCurveOverlay()` — 编辑模式下在 `curveLayer` 画**锚点 + 切线手柄**（仅交互元素）。⚠️**已移除蓝色轮廓线**（曾从 `padMesh` 顶面提取闭合边界边绘制，与 3D 渲染外形重复，2026-08-28 移除；相关 `?diag` 对比调试块一并删除）。轮廓外观改由 `padMesh` 渲染结果直接呈现
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
- **轮廓外形的唯一真相是 `padMesh` 的 3D 渲染结果**：`makeClassicShape()` → `ExtrudeGeometry` → `padMesh`，叠加层不再画轮廓线（2026-08-28 移除蓝线）。因此**不再存在「叠加层轮廓 vs 渲染轮廓」对不齐这类问题**
- **锚点定位仍以顶面为准**：`shapeToScreen()` / `screenToShape()` 用 `shapeTopY() = P.thick/2 + P.bevel`（顶面高度），保证锚点圆与渲染出的顶面在同一平面上，拖拽手感与视觉一致
- 鼠标垫颜色（材质色、贴图）由 `P.t1 / P.t2 / P.baseColor / P.padColor` 等参数控制
- 编辑模式下也显示腕托 cushion、保留立体倒角，以呈现实际渲染状况（鼠标垫立体外观、腕托凸起、光照/贴图）；锚点/手柄覆盖层始终绘制在 3D 之上，拖拽编辑不受影响
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
- **剪贴板粘贴按钮结构约定**：`📋` 按钮（`#paste1`/`#paste2`，class `paste-btn`）是 `.dz-wrap` 内、**dropzone 之前的兄弟节点**，用绝对定位固定在 dropzone 左侧、等高。⚠️**不要把它放回 dropzone 内部**——`setDZPreview`（`dz.innerHTML=''`）与 `resetDZ`（`innerHTML=html`）会重写 dropzone 内容，若按钮是子节点会被一起删掉、上传/清除后不再显示。按钮绑定在 `bindDropzone()` 内：`document.getElementById('paste'+dzId.slice(2))`，点击读取 `navigator.clipboard.read()` 取 `image/*` 类型 `Blob` 走 `loadImage`。`navigator.clipboard.read()` 仅在 `https`/`localhost` 安全上下文可用，`file://` 直接打开会为 `undefined`（已 `if(!navigator.clipboard)` 兜底提示）。按钮**不要加 `.btn` 类**（否则被全局 `.btn` 的 `width:100%`/粉色渐变/`margin-top` 覆盖），其样式由 `button.paste-btn` 独立声明
- **用户反馈统一用 toast**：所有面向用户的提示（导入成功/失败、剪贴板不支持/无图/异常等）一律调用 `toast(msg, type, ms)`（`type` 取 `''`/`'ok'`/`'err'`：`err` 红字，其余普通文字，**边框无特殊设计**），**严禁新增 `alert()`**。`toast` 为非阻塞底部居中提示，自动淡出；如需阻塞式确认勿用 `alert`，应自建模态

- **`ensureClassicCtrl` 的 stale 判断**：只要求每个点 `x/y` 有限；若某点"部分有手柄"（`p.h1||p.h2` 但缺其一）才判无效。中间接缝锚点可**完全无 `h1/h2`**（合法），返回前会由 `ensureClassicCtrl` 自动补一对平滑共线手柄，避免 `makeClassicShape()` 的贝塞尔链读到 `undefined` 手柄。**曾误判"无 h 的点"为 stale 而退回程序化默认形状**，导致默认外形不符设计稿
- **经典轮廓导入兼容**：`importConfigFile` 已兼容旧版 `{p:{x,y}, h1, h2}` 嵌套格式（自动提升为顶层 `{x,y,h1,h2}`）。但优先保持运行时顶层格式；导入任何顶层格式的设计稿后，其外形应与默认外形（同一 `DEFAULT_CLASSIC_CTRL`）一致
- **⚠️ 足迹变换顺序：先缩放后旋转，不可颠倒**：3D 腕托的局部矩阵是 `T·R·S`（`mesh.scale` 先作用、`rotation.y` 后作用），`wristFootprint()` 必须同样「缩放 → 旋转」。**曾写成在单位空间里先旋转后缩放**，对非圆截面（rx≠rz）会产出与真实 cushion 完全不同的轮廓（整体款 45° 时偏差达 34 单位），且旧代码整体款还把旋转方向写反（`wristGroup.rotation.y` 是 +θ，足迹算的是 −θ）
- **⚠️ 垫身总长/腕托位置必须取「未旋转」基准**：`padH` 与 `classicZBaseCache` 只能由 `buildFootprint(_, true)`（忽略旋转角）的足迹跨度推算。**曾直接用旋转后足迹的纵向跨度**，而该跨度随旋转角变化（侧缘点绕腕托中心摆动，整体款 0°→90° 跨度 36→99）→ 旋转时垫身被拉长/缩短、腕托整体前后平移（整体款 0°→90° 腕托中心位移 81）。改完这两项后：旋转仅改变包裹轮廓外形，腕托中心与总长恒定，整体款因「旋转后 cushion 确实更深」而保留的底部加深属物理必然

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
