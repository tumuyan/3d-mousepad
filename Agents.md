# Agents.md — 3D MousePad Studio 协作规范

面向后续开发的**规范性文档**：统一术语、记录必须遵守的约束与易错点。
写法约定：只陈述「当下的规则是什么、为什么」，不记录变更过程与历史。

## 1. 术语对照（用户视角 ↔ 代码）

| 用户术语 | 代码 | 说明 |
| --- | --- | --- |
| 鼠标垫（模型） | `padMesh`（`ExtrudeGeometry(makeShape())`） | 垫身本体，与腕托是两个独立对象 |
| 腕托 cushion | `wristGroup`（缩放的 `SphereGeometry`） | 始终可见（含编辑模式） |
| 经典形状 / 经典款 | `P.shape === 'classic'` | 上半轮廓由贝塞尔锚点决定。代码中一律用 `'classic'`，**不要用 `hug`** |
| 圆角矩形 / 椭圆 / 胶囊形 | `'rect'` / `'ellipse'` / `'stadium'` | 其余形状 |
| 上半轮廓 | `makeClassicShape()` 中由 `classicCtrl` 生成的贝塞尔部分 | 锚点可拖拽 |
| 下半轮廓 / 腕托足迹 | `makeClassicShape()` 中由 `bottomPts` 生成的部分 | 由 `wMargin / wPos / wD / wristStyle` 决定，**不接受拖拽** |
| 控制点叠加层 | `drawCurveOverlay()` 画的黑色锚点圆 + 橙色手柄方块 | 只画锚点与手柄，**不画轮廓线**——外形看 3D 渲染结果 |
| 编辑模式 | `curveEdit = true` | 「鼠标垫外形」组第二项，默认不勾选 |
| 正交相机 | `orthoCam` | 编辑模式专用，与 `shapeToScreen` 投影同源，保证 1:1 |
| 配置导出 / 导入 | `serializeConfig()` / `importConfigFile()` | 支持 `.json` 与 `.zip`（ZIP 内含贴图） |
| ZIP 打包 / 解包 | `makeZip()` / `parseZip()` | 纯前端 `CompressionStream` 实现，零依赖 |
| 导出模型 | `exportModel3D('glb'\|'stl'\|'obj')` | 见 §4 导出 |
| 模型渲染图 | `exportModelPNG()` | 见 §4 导出 |
| Toast 提示 | `toast(msg, type, ms)` | 所有用户反馈统一走它，**禁止新增 `alert()`** |

## 2. 单位约定

**所有长度参数与世界坐标一律为毫米，1 世界单位 = 1mm**，无全局缩放。
常量 `MM_PER_UNIT = 1` 是换算的唯一出处；同类量级参照：`shadowPlane` 2000、光半径 500、阴影相机 ±320、相机 `near 1 / far 6000`、`PERSP_POS` 距离 470。

⚠️ 倒角会让成品大于参数（`bevelSize = bevel × 0.9` 向外扩、`bevelThickness` 上下各加一层）：

| 项 | 关系 |
| --- | --- |
| 成品外廓 | `基础宽度`/`基础长度` + `1.8 × 边缘倒角` |
| 成品总厚 | `基础厚度` + `2 × 边缘倒角` |

默认参数下实际成品为 **235.4 × 270.4 × 7 mm**。因此这三个控件的显示名带「基础」前缀（指倒角前的轮廓值），悬停提示写明换算公式。
做切割线 / 印刷出血时须先明确取「顶面印刷区」还是「外轮廓剪影」——顶面比外廓再内缩 `bevelSize`。
⚠️ 不要为了让参数等于成品而改几何，那会让所有已有设计的外观整体缩小。

## 3. 关键代码定位

**几何**
- `makeShape()` → `makeClassicShape()`：生成垫身 `THREE.Shape`（上半贝塞尔 + 下半足迹折线）
- `buildPad()` / `buildWrist(topY)`：构建 `padMesh` / `wristGroup`；顶面高度 = `P.thick/2 + P.bevel`
- `wristFootprint(kind, opts)`：采样腕托足迹（右→左）。⚠️ 变换链必须与 3D 逐字一致：**单位球 → 变形 → 缩放 → 绕 y 旋转**，`noRot=true` 忽略旋转角
- `buildFootprint(out, noRot)`：`makeClassicShape()` 调两次 —— `false` 出真实轮廓，`true` 出旋转无关的布局基准（垫身总长 + 腕托 z 基准）
- `rebuild(padOnly)`：`padOnly` 仅在改动只影响 `P.classicCtrl` 时使用（足迹不读锚点，故可跳过腕托）。新增 `padOnly` 调用点前须重新核对依赖

**锚点（经典形状）**
- `P.classicCtrl`：`[{ x, y, h1:{x,y}, h2:{x,y}, pin?:true }]`，首尾 `pin` 为接缝点。**运行时一律用顶层 `{x,y,h1,h2}`**；`{p:{x,y}}` 是旧版导出格式，仅导入时兼容
- `DEFAULT_CLASSIC_CTRL`：出厂默认锚点链，`重置锚点` 恢复到此常量。⚠️ 点数不固定，不要硬编码；改默认外形时整段复制设计稿的锚点，不要自创或增减点
- `bakeClassicCtrl` / `ensureClassicCtrl` / `autoSmoothClassicCtrl`：烘焙 / 校验 / 平滑
- `norm2(x,y)`：全局归一化工具函数，任何需要单位向量的地方复用它，不要重复定义
- 端点切线（G1）：`dBLv`/`dBRv` 须取「离开端点沿底轮廓向内」的方向（即 `bottomPts[n-2] - pBL`），反向会导致一侧出现折痕

**编辑模式**
- `setEditOrtho()`：按 shape 真实 bbox 计算正交视锥，中心对齐几何中心。改后须由 `rebuild()` / `resize()` 触发重算
- `shapeToScreen()` / `screenToShape()`：以顶面 `P.thick/2 + P.bevel` 为基准投影
- `setCurveEdit(on)`：切换 `curveEdit`、正交渲染、`controls.enabled`、覆盖层显隐

**UI / 配置**
- `uiSyncers`：控件**数值**同步器数组，导入配置后遍历刷新。⚠️ 只同步值，**不处理显隐**
- `refreshShapeUI()` / `refreshWristUI()`：分组**显隐**。导入路径必须调用，新增「按参数隐藏某行」的逻辑要挂进这里
- `colorRow()`、`checkRow()` **必须 `return row`**，否则依赖返回值的行（如边缘颜色）无法控制显隐
- `slider(parent, label, min, max, step, get, set, note)`：`note` 为可选悬停说明
- `.row label` 固定 `flex:0 0 64px`，标签不超过 5 个汉字，否则挤压滑条
- 经典模式「鼠标垫外形」组顺序：`腕托顶距` → `编辑轮廓`（默认不勾选）→ `外形超出腕托`；`重置锚点` 按钮挂在「编辑轮廓」行右侧，恢复 `DEFAULT_CLASSIC_CTRL`
- `#topbar .dd-menu` 必须左对齐（`.dd-menu` 默认 `right:0` 是为右上角 `#toolbar` 设计的）

## 4. 导出

**模型渲染图 `exportModelPNG()`**
保持当前视角（相机位置/视锥/zoom/aspect 全不动），用 `cam.setViewOffset()` 把渲染视窗开在模型的投影矩形上，再按 alpha 裁掉残余透明边。
- `modelNDCRect()`：遍历全部顶点投影得 NDC 包围盒（顶点级，比 `Box3` 贴合剪影）；顶点跨近平面时返回 `null`，退化为整屏导出
- ⚠️ 不要用世界 AABB 的 `size.x/size.y` 反推取景：鼠标垫躺在 XZ 平面，`size.y` 只是厚度，`size.x/size.z` 也不对应屏幕横竖方向
- 输出分辨率 = 投影矩形的屏幕像素 × `P.exportScale`，长边上限 8192（浏览器画布上限）

**3D 模型 `exportModel3D(kind)`**
- `loadExporter(kind)`：按需动态 `import()`（走 importmap 的 `three/addons/` 前缀）并缓存，specifier 必须写**字面量**
- `buildExportRoot({ bakeUV, unit })`：只含 `padMesh` + 可见 `wristGroup`，几何 `clone()` 后烘焙世界矩阵（输出节点无变换）；材质去重，命名 `PadTop`/`PadEdge`/`WristRest`，节点 `Pad`/`WristRest_n`
- ⚠️ 腕托的 `clippingPlanes` 只在渲染期丢弃片元，必须经 `clipYOfMats` + `flattenBelowY` 落实到顶点，否则腕托会从垫身底部整个穿出。新增带 clipping 的材质要确认能被 `clipYOfMats` 识别（目前只认水平向上的平面）
- ⚠️ 越界顶点要**压平**而非删面——删面会在底部开口、slicer 判为非法网格。压平后须重算法线并把零长度法线补成 `(0,-1,0)`（glTF 要求单位法线）
- 单位由 `MM_PER_UNIT` 推导：STL/OBJ = 1mm，GLB = 1m（`UNIT_M = MM_PER_UNIT/1000`）。不要写死
- GLB 材质是近似：页面的 `onBeforeCompile` 混合与 `cutout` 镂空无法写进 glTF，退化为 `map × color` + 单一 alpha。贴图**定位**精确（`bakeUVTransform` 烘焙 `texture.matrix` 进 uv，绕开 `KHR_texture_transform` 不支持 `center`），但混合强度会丢失
- `disposeExportRoot()`：释放克隆出的 geometry / material / texture

## 5. 易错点

- `padMesh` 与 `wristGroup` 是两个独立对象，不要混淆
- 足迹变换**先缩放后旋转**，不可颠倒（3D 局部矩阵是 `T·R·S`）；垫身总长与腕托位置只能取**未旋转**基准 `buildFootprint(_, true)`，否则旋转会带着垫身拉长、腕托平移
- 导入配置的完整同步链：`rebuild()` + `refreshShapeUI()` + `refreshWristUI()` + `uiSyncers.forEach()` + `syncTexUI('t1'/'t2')`
- `makeTex(url, cb)` 第二参是加载回调；`setDZPreview(dz, ...)` 第一参必须是 DOM 元素
- `📋` 粘贴按钮（`.paste-btn`）是 dropzone 的**兄弟节点**，不能放进 dropzone 内部（`innerHTML` 重写会删掉它）；不要加 `.btn` 类
- 调试前硬刷新（Ctrl+Shift+R），避免用旧版 JS 判定问题
- 腕托与倒角在所有模式下均显示，不存在「退出编辑才出现」的状态

## 6. 仓库结构

```
index.html   主程序（纯前端单文件，Three.js 经 importmap 从 CDN 加载）
server.js    本地静态服务器：node server.js [默认端口 5213]
README.md    项目说明与运行方式
package.json 仅声明 playwright 等调试依赖，运行项目不依赖 npm 包
Agents.md    本文件
```
- 调试产物 `snap*.yaml`、`*_diag*`、`*.png`、`server.log` 已在 `.gitignore` 中，不应提交
