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
| 配置导出 / 导入 | `serializeConfig()` / `importConfigFile()` | 支持 `.json` 与 `.zip`（ZIP 内含贴图）。导入经 `sanitizeParams()` 白名单校验，见 §5 |
| ZIP 打包 / 解包 | `makeZip()` / `parseZip()` | 纯前端 `CompressionStream` 实现，零依赖。**只支持 store（method 0）**，其余压缩方式一律抛错 |
| 导出模型 | `exportModel3D('glb'\|'stl'\|'obj')` | 见 §4 导出 |
| 模型渲染图 | `exportModelPNG()` | 见 §4 导出 |
| 渲染脏标记 | `markRenderDirty()` / `markShadowDirty()` | 主循环按需渲染，见 §5。前者管画面，后者管阴影贴图 |
| 参数变更分发 | `applyParam(key, v)` / `applyParamThen(key, v, extra)` | 按 `PARAM_SCHEMA[key].onChange` 决定重建 / 刷材质 / 只置脏，见 §2.5 |
| 文案 | `T(key, vars)` / `applyI18n()` / `regI18n(el, kind, key)` | 见 §2.5。缺词时 `T()` 返回 key 本身 |
| 自动草稿 | `scheduleDraft()` / `store.saveDraft()` | 参数变更防抖 600ms 落 localStorage，启动时恢复并跑一遍同步链 |
| 方案槽位 | `store.saveSlot/loadSlot/deleteSlot/listSlots` | 元数据在 localStorage，参数与贴图在 IndexedDB |
| LOD 预览 | `enterLOD()` / `commitLOD()` / `ensureFullQuality()` | 交互中用低精度几何，见 §5 |
| 几何异常兜底 | `guardedRebuild()` / `clampGeoParams()` | `rebuild()` 抛异常时 toast + 回退上一个成功参数。`rebuild()` 返回 `false` = 本次失败，见 §5 |
| Toast 提示 | `toast(msg, type, ms)` | 所有用户反馈统一走它，**禁止新增 `alert()`** |
| 工具栏 | `#toolbar` | 唯一的顶部工具栏：左组 `.tb-left`（导出/配置）+ 右组 `.tb-right`（模式/视角）。**不要**再新增第二个绝对定位的工具栏 |
| 参数面板 / 抽屉 | `#panel` | 宽屏常驻左栏；窄屏（≤900px）变覆盖式抽屉，由 `body.panel-open` 切换 |
| 参数按钮 | `#panelToggle` / `setPanelOpen(on)` | 仅窄屏可见。**就是工具栏左组里的一个普通按钮**（在「配置」左边），不是浮层。文案由 CSS 按 `body.panel-open` 切换，不在 JS 里写 |
| 折叠把手 | `#panelHandle` / `togglePanel()` | 仅窄屏可见，贴在抽屉右缘：收起时停在屏幕左缘当拉手，展开时跟到抽屉右缘当收手。**必须是 `#panel` 的兄弟节点**（`#panel` 有 `overflow-y:auto`，子元素放进去会被裁掉） |
| 遮罩 | `#panelScrim` | 抽屉打开时铺满视口，点它收起。**层级低于抽屉**，见 §5 |
| 超尺寸贴图处理弹窗 | `#texFix` / `fixOversizeTexture()` / `tf*` | 贴图任一边超过 `MAX_TEX_EDGE` 时弹出的裁剪 + 压缩界面，见 §3「贴图」 |
| 长边裁剪滑条 | `#tfSize` / `tfEdgeValue()` / `tfFinalSize()` | 只把**输出**按长边等比压小，量程 `[1, 原图长边]`，最右端 = 不压缩。放大不是它的职责 |
| 手势锚点 | `pinch.m0` / `pinch.p0` | 双指起始中点下的垫面位置（`m0` 是 uv，`p0` 是世界坐标）。缩放全程围绕它，见 §5 |
| 锚点缩放 | `zoomTexAbout(tp, t, ns, m)` | **以垫面某点为锚点改缩放**的唯一实现：反解 `ox/oy` 使该点下的贴图像素不动。滚轮与双指捏合都走它 |
| 屏幕 ↔ 垫面映射 | `uvAtPoint(e)` / `clientToTopPlane(x, y)` | 前者给 uv，后者给世界坐标，投影平面都是垫面顶面。手势漂移量必须在这对函数间换算 |

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

## 2.5 模块拆分（原生 ES module，零构建）

`index.html` 持有唯一的 `<script type="module">`，其余按职责拆到 `src/`：

| 模块 | 内容 | 能否 import three |
| --- | --- | --- |
| `src/util.js` | norm2 / clampNum / 点路径读写 | ❌ |
| `src/params.js` | `P` 默认值、`PARAM_SCHEMA`（含 `onChange`）、`sanitizeParams` | ❌ |
| `src/config.js` | ZIP(store) 打包解包、安全文件名、`migrateConfig` | ❌ |
| `src/textureMath.js` | 裁剪压缩计算、`zoomTexAbout` 反解 | ❌ |
| `src/anchors.js` | 贝塞尔锚点烘焙 / 平滑 / 校验 | ❌ |
| `src/footprint.js` | 腕托足迹采样 / 等距外扩 / 去自交 | ❌ |
| `src/store.js` | localStorage + IndexedDB 持久化 | ✅（只用 Web API） |
| `src/i18n.js` | 中英词典与语言切换 | ❌ |

> ⚠️ 标 ❌ 的模块**不得 import three**：它们要能在 `npm run unit` 里被 node 直接 import。
> 一引入 three 就只能走浏览器 + CDN，反馈环从毫秒级退化到分钟级 —— 拆模块的主要收益即此。
> 需要 `THREE.MathUtils.clamp` 时用 `src/util.js` 的 `clampNum` 代替。

**参数变更分发（不再手写 `P.x = v; rebuild()`）**
控件回调走 `applyParam(key, v)`：它按 `PARAM_SCHEMA[key].onChange` 决定后续动作
（`rebuild` / `material` / `render` / `none`）。额外副作用（如改外形要同步分组显隐）
写在 `applyParamThen(key, v, extra)` 的 `extra` 里。
⚠️ `rebuild` 与 `material` 不能互换：写反会让每次拖滑条白跑一次全量几何重建。

**文案一律走 i18n**
界面上不出现硬编码中文。HTML 静态文案用 `data-i18n`（及 `-html` / `-title` / `-aria` /
`-placeholder` 变体）标记；JS 生成的文案用 `T(key)`，需要切换时重刷的节点经 `regI18n()`
登记。`data-i18n-html` 只用于含 `<b>/<small>` 的常量文案，**不要**拿它渲染外部数据。
⚠️ 段落里若嵌着运行时数字（如 `#tfDim`），整段不能进词典 —— 否则切语言会把承载数字的
`<span>` 一起冲掉。拆成"数字前 / 中 / 后"三段纯文本。

## 3. 关键代码定位

**几何**
- `makeShape()` → `makeClassicShape()`：生成垫身 `THREE.Shape`（上半贝塞尔 + 下半足迹折线）
- `buildPad()` / `buildWrist(topY)`：构建 `padMesh` / `wristGroup`；顶面高度 = `P.thick/2 + P.bevel`
- `weldCreased(geo, deg)`（`buildPad()` 内，方案 A）：`ExtrudeGeometry` 是非索引几何 → `computeVertexNormals()` 只能得逐面法线、倒角呈平面带。本函数一次完成「焊接成索引几何 + 按折痕角聚类平滑法线」。⚠️ 只改法线与索引，**位置一个字节都不动**（外廓/厚度/包围盒/阴影不变）
- `wristFootprint(kind, opts)`：采样腕托足迹（右→左）。⚠️ 变换链必须与 3D 逐字一致：**单位球 → 变形 → 缩放 → 绕 y 旋转**，`noRot=true` 忽略旋转角
- `buildFootprint(out, noRot)`：`makeClassicShape()` 调两次 —— `false` 出真实轮廓，`true` 出旋转无关的布局基准（垫身总长 + 腕托 z 基准）
- `rebuild(padOnly)`：`padOnly` 仅在改动只影响 `P.classicCtrl` 时使用（足迹不读锚点，故可跳过腕托）。新增 `padOnly` 调用点前须重新核对依赖。**返回值 `false` 表示本次重建失败（已 toast + 参数回退）**，调用方若还要做几何相关的后续动作（如 `fitEditOrtho()`）必须先看它 —— 按半成品几何算包围盒会把编辑视口缩放到荒谬尺度
- `guardedRebuild(body)` / `clampGeoParams()` / `captureGeoSnapshot()`：几何入口的异常兜底与参数闸门。`rebuild()` 内部的几何段（`buildPad` + `buildWrist`）包在 `guardedRebuild()` 里，异常时 toast + 回退到上一个成功参数并立刻重建回可用状态。`GEO_PARAM_KEYS` 是"参与几何的参数"的唯一清单，`captureGeoSnapshot()` 只记它
  - ⚠️ 上界取「滑条 max」与「`PARAM_SCHEMA` 上界 + 25% 余量」的**较小者**。两者不可偏废：只按 schema 放行会让"滑条到头了 P 仍能更大"成为无提示的越界通路（实测 `wW` 滑条 60~260 / schema 10~500，`wD` 滑条 40~160 / schema 5~400 都不一致）；只按滑条则 `PARAM_SCHEMA` 形同虚设。新增几何类滑条时必须登记到 `SLIDER_PARAM`，否则该参数退回宽口径
  - ⚠️ 下界对 0 基参数恒为 0：`makeClassicShape()` 里 `wMargin = -1` 是"贴合足迹"的哨兵值，夹成正数会改变默认外形
  - ⚠️ `classicCtrl` 必须**深拷贝**进快照：异常路径常发生在编辑锚点的过程中（拖锚点 → `rebuild`），共用数组会让"回退"把坏几何原样写回去

**锚点（经典形状）**
- `P.classicCtrl`：`[{ x, y, h1:{x,y}, h2:{x,y}, pin?:true }]`，首尾 `pin` 为接缝点。**运行时一律用顶层 `{x,y,h1,h2}`**；`{p:{x,y}}` 是旧版导出格式，仅导入时兼容
- `DEFAULT_CLASSIC_CTRL`：出厂默认锚点链，`重置锚点` 恢复到此常量。⚠️ 点数不固定，不要硬编码；改默认外形时整段复制设计稿的锚点，不要自创或增减点
- `bakeClassicCtrl` / `ensureClassicCtrl` / `autoSmoothClassicCtrl`：烘焙 / 校验 / 平滑
- `norm2(x,y)`：全局归一化工具函数，任何需要单位向量的地方复用它，不要重复定义
- 端点切线（G1）：`dBLv`/`dBRv` 须取「离开端点沿底轮廓向内」的方向（即 `bottomPts[n-2] - pBL`），反向会导致一侧出现折痕

**渲染与性能**
- `markRenderDirty()`：主循环**按需渲染**（静止时完全不重绘）。⚠️ 任何改变画面的新入口都必须调用它，漏掉 = 画面不更新。兜底是「连续 30 帧无渲染则无条件渲染一次」的安全阀，漏置脏表现为「最多延迟半秒」而非永久卡死
- `markShadowDirty()`：阴影贴图按需更新（`shadowMap.autoUpdate = false`）。只与**几何**（`rebuild()`）和**光源方位**（`updateLights()` 里 `keyLight.position` 变化时）有关。光源强度/颜色、环境光、环境反射、接收面可见性都**不**影响深度图，改这些不要置脏。⚠️ 不能改用「把 `keyLight.castShadow` 绑到 `P.shadow`」——那会连带删掉腕托投在垫身上的阴影
- `enterLOD()` / `commitLOD()` / `ensureFullQuality()`：交互中用低精度几何（`curveSegments 24`、球 `32×24`、`bevelSegments 2`），松手后全质量重建。⚠️ 导出与配置保存前必须 `ensureFullQuality()`，否则成品是低精度版本
- `LOD.full.bevelSegments = 8`（原 5）：焊接后顶点数只有非索引的 ~1/5，故段数上调。**段数不影响外廓与总厚**（最外环恒在 `bs = bevelSize` 处，与段数无关），只影响倒角弧面的高光连续性；想压导出体积可下调（STL 按三角收费）
- `window.padGeoInfo()` / `window.setDbgRebuild(v)`：供调试与冒烟脚本读取的**外部口子**（垫身几何概要 / rebuild 耗时开关）。⚠️ 冒烟脚本依赖 `padGeoInfo` 的返回字段（`indexed` / `groups` / `verts` / `uniquePos`），改字段名或删除会让 4 条方案 A 断言同时失败
- `window.__geoState()` / `window.__geoFaultOnce(msg)`：几何兜底的测试口子（只读参数快照 / 注入一次性 `buildPad` 故障）。
  ⚠️ 兜底链路**只能靠真抛一次异常**来验证 —— 光断言"改一堆参数没崩"证明不了它存在（改之前也全绿）。
- `wristRough()`：腕托粗糙度（`min(1, P.rough + 0.1)`）的**唯一定义**。`buildWrist()` 与 `updateMatRough()` 必须都调它 —— 写死两份的话，调公式极易只改一处，表现为「拖滑条一个值、重建后跳到另一个值」，不报错
- 粗糙度分布：顶面 = `P.rough`，腕托 = `wristRough()`，**边缘固定 `EDGE_ROUGH`（0.85）、不随 `P.rough` 变化**。`updateMatRough()` 刻意不带 `edgeMat`：非 `edgeSame` 时边缘恒 0.85，是 `edgeSame` 时它本就是 `padTopMat`。已实测确认（GLB 材质读数 + 与 rebuild 路径截图逐字节相同）
- `updateMatBase()` / `updateMatRough()` / `updateEdgeColor()` / `updateCutout()`：**纯材质更新路径**，只写 uniform / color，不碰几何、不重建。分别服务：本色与不透明度、表面粗糙、边缘颜色、重复模式（`uCutout`）。四者都只 `markRenderDirty()`，不 `markShadowDirty()`
- `uCutout`：由 `patchMapBlend` 的 `onBeforeCompile` 在**编译期求值一次**，故切换重复模式不能只改 `P.t1.wrap` 就完事，必须再调 `updateCutout()` 直写 uniform（旧实现靠 `rebuild()` 重建材质来刷它，代价是全量几何重建）

**编辑模式**
- `fitEditOrtho()`：按 shape 真实 bbox 计算正交视锥，中心对齐几何中心。⚠️ 视口已与 `rebuild()` **解耦**（拖锚点不再自动缩放），只在明确入口调用：进入编辑 / 重置锚点 / 适应视图 / 导入配置 / 足迹类滑条（基础宽度、腕托顶距、外形超出腕托）
- `applyEditOrtho()`：只按当前 `cvCx/cvCy/cvHalf` + 画布 aspect **套用**视锥，不重新 fit。⚠️ 窗口 resize 走的是它、`fitEditOrtho()` 结尾也调它 —— 两者别混用：resize 只改留白，不改变中心与缩放
- `shapeToScreen()` / `screenToShape()`：以顶面 `P.thick/2 + P.bevel` 为基准投影。倒角在所有模式下都启用，该高度不随编辑模式变化
- `setCurveEdit(on)`：切换 `curveEdit`、正交渲染、`controls.enabled`、覆盖层显隐。**不重建几何**（只换相机与叠加层），仅 `commitLOD()` 收尾可能残留的低精度状态

**UI / 配置**
- `uiSyncers`：控件**数值**同步器数组，导入配置后遍历刷新。⚠️ 只同步值，**不处理显隐**
- `refreshShapeUI()` / `refreshWristUI()`：分组**显隐**。导入路径必须调用，新增「按参数隐藏某行」的逻辑要挂进这里
- `colorRow()`、`checkRow()` **必须 `return row`**，否则依赖返回值的行（如边缘颜色）无法控制显隐
- `slider(parent, label, min, max, step, get, set, note)`：`note` 为可选悬停说明
- `.row label` 固定 `flex:0 0 64px`，标签不超过 5 个汉字，否则挤压滑条
- 经典模式「鼠标垫外形」组顺序：`腕托顶距` → `编辑轮廓`（默认不勾选）→ `外形超出腕托`；`重置锚点` 按钮挂在「编辑轮廓」行右侧，恢复 `DEFAULT_CLASSIC_CTRL`
- `#toolbar .tb-left .dd-menu` 必须左对齐（`.dd-menu` 默认 `right:0` 是为右组设计的）。
  ⚠️ 旧节点名 `#topbar` 已并入 `#toolbar`，下拉菜单的事件绑定选择器同步为
  `#toolbar .tb-left .dropdown` —— 改结构时**必须**一起改，否则导出/配置菜单全部点不动
  且不报错（实测：全部 6 个导出/导入入口静默失效，冒烟测试才抓到）
- `resize()` 由 **ResizeObserver 观察 `#stage`** 触发，另挂 window.resize 与 orientationchange。
  ⚠️ 不能只监听 window.resize：窄屏抽屉开合**不改变** window 尺寸但 #stage 确实变了；
  移动端地址栏收起、软键盘、横竖屏旋转也只改可视高度。漏掉会让画布 backing store
  停在旧尺寸被拉伸（实测取到抽屉动画中途的中间宽度，画面横向拉长且偏离中心）。
  `resize()` 里尺寸为 0 时直接 return：setSize(0,0) 会把画布置死、`aspect=NaN` 污染投影矩阵

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

## 5. 移动端 / 窄屏适配

**两档断点**（都在 `index.html` 的 `<style>` 末尾，按出现顺序即优先级）：

| 条件 | 变化 |
| --- | --- |
| `max-width: 900px` | `#panel` 变覆盖式抽屉（`transform: translateX(-100%)`）、宽度写入 `#app` 的 `--panel-w`，画布占满视口，`#panelToggle` 与 `#panelHandle` 出现 |
| `max-width: 480px` | 工具栏两组各占一整行 |
| `max-height: 480px` 且 `max-width: 900px` | 横屏手机：工具栏再压一档 |
| `pointer: coarse` | 滑条/复选框/按钮的命中区域抬到 ~44px（iOS HIG 最小可点尺寸） |

**必须遵守的约束**
- 断点用 `900px` 而不是更常见的 `768px`：工具栏两组按钮在 ~1024px 就开始挤，900px 以下已明显重叠
- 画布区域固定 `touch-action:none` + `overscroll-behavior:none`：否则浏览器会接管单指滑动
  （变成页面滚动）并在滚到尽头时触发下拉刷新，与 OrbitControls 抢手势
- `<meta name="viewport">` 带 `maximum-scale=1.0, user-scalable=no, viewport-fit=cover`：
  移动端画布上的单指旋转若被浏览器当成页面缩放，会与应用手势反复打架
- 高度一律 `100dvh`（回退 `100vh`）：移动端地址栏收起/展开会改可视高度
- 安全区：`#panel` / `#toolbar` 的 padding / 定位都套 `env(safe-area-inset-*)`
- 抽屉宽度只写一处：窄屏 `#app { --panel-w: min(calc(100vw - 56px), 340px) }`，`#panel` 与
  `#panelHandle` 共用。⚠️ 变量挂在 `#app` 而不是 `#panel`：把手是 `#panel` 的兄弟节点，
  挂在 `#panel` 上的自定义属性它继承不到（实测表现为展开时把手停在 `left:0` 一动不动）
- 触摸事件只用于**补 pointer 事件覆盖不到的两类场景**，其余一律走 pointer 事件（桌面触屏共用一套）：
  - 双指手势：浏览器只给第一根手指派发稳定的 pointer 序列，贴图缩放的 pinch 必须用 `touchstart/move`
  - 手势中断兜底：拖锚点途中被系统手势打断时 `pointerup` 可能不来，用 `touchend/touchcancel` 收尾
- ⚠️ **双指缩放的方向是 `ns = s0 * (d0 / d)`，不是 `s0 * (d / d0)`** —— 分母分子不能对调。
  `tp.s` 是 uv 的 repeat 系数（`t.repeat.set(p.s * fx, ...)`），**越大贴图越小**，与画面大小**反号**。
  手指张开（`d` 增大）要放大贴图，就得让 `s` 变小，故取 `d0 / d`。
  写成 `d / d0` 时 `s` 的变化方向「看起来正确」（张开→s 变大），画面却正好反着 ——
  这个反号让上一版漏掉了，Issue #3 报的「捏合缩放效果还是反的」即此。
  ⚠️ 回归断言不能只比 `s` 的数值方向，必须同时量画面（如红半边变宽/变窄），
  单看 `s` 会被这个反号骗过去。
- ⚠️ **双指缩放的锚点必须反解 `ox/oy`，不能只写 `tp.s = s0 * (d0 / d)`**。
  只改 `s` 时贴图会**整块从手指底下平移出去**（手感是「越缩越跑」），而不是围绕手指原地放大 ——
  因为贴图缩放不是围绕画布中心、而是围绕 `ox/oy` 对应的点进行的。反解走 `zoomTexAbout()`，
  **滚轮与捏合共用同一份**：两处都要「以输入位置为锚点」，各写一份必然漏一处
  （触屏捏合最初就是这么漏的）。
  - 锚点取起始两指中点下的垫面 uv（`m0`），**不是**画布中心、也不是贴图中心
  - ⚠️ 反解必须固定在「手势起始状态」（`s0/ox0/oy0`）上做，再套用新的 `s`。
    拿上一帧的 `s/ox/oy` 迭代会把浮点误差逐帧累积，表现为缩放越拖越偏
  - 两指整体平移（指距不变、中点漂移）时锚点要**跟着手指走**：漂移量经
    `clientToTopPlane` 换算成 uv 加回偏移。锚点通常含有平移分量，忽略它会让手势打架
  - 起始中点落在垫面外（射线未命中）时退化为「只改 `s`」，此时锚点无意义
- ⚠️ **双指旋转用 `r -= Δa`，减号不能改成加号**。屏幕坐标 y 向下，`atan2` 角度增大 = 视觉顺时针；
  而 `P.tn.r > 0` 在画面上是**逆时针** —— three 的 uv rotation 在「v 轴向上」的纹理空间里是逆时针，
  经 `uvAtPoint` 的 `v = 0.5 - z/S` 翻到画面后方向反转。两者反向，取减号才对得上手。
  实测（红色半边重心随 r 的位移）：`r=+15` 重心下移 → 逆时针，`r=-15` 重心上移 → 顺时针。
  改回加号会让「手指顺时针、贴图逆时针」，正是 Issue #3 报的现象；`smoke-mobile` 有两项断言专门盯它。
- ⚠️ **滚轮缩放的符号已统一为「向上 = 放大」，不可再改回负号**。滚轮现为
  `s * exp(deltaY * 0.001)`：向上滚（`deltaY < 0`）→ `s` 变小 → 贴图**放大**，
  与捏合（张开手指 → `s0 * d0 / d` → `s` 变小 → 放大）同向。
  来历：原写作 `exp(-deltaY * 0.001)`，桌面路径上一直是「向上滚 = 缩小」，与捏合正好相反，
  曾被记为本节的一条已知差异，后由 Issue #10 统一。改回负号会让所有桌面用户的滚轮反向，
  `smoke-zoomwheel` 里「滚轮向上 = 放大」与「与捏合同向」两项断言专盯它。
  只改了这一处符号：`zoomTexAbout`（锚点反解）与 `Shift+滚轮` 的旋转路径都未动。

**层叠顺序（不可随意改动）**：`遮罩(7) < 抽屉(9) = 折叠把手(9) = 工具栏(9)`

- ⚠️ **`#app` 必须自己建立层叠上下文**（`position:relative; z-index:0`）。否则页面各浮层
  各自另立门户，`z-index` 数字**互相之间根本不可比**：抽屉是 `#app` 的子元素（9），
  工具栏却是 `#stage` 的后代（旧写法 11），11 压不住 9。实测抽屉打开时，面板里的
  `<h1>3D MousePad Studio` 整片盖在工具栏按钮上，只从按钮缝隙里露出一个「S」。
  所有层级断言都建立在「以 `#app` 为唯一基准」这个前提上。
- ⚠️ 抽屉层级要**高于**工具栏（用户明确要的「抽屉盖住悬浮按钮」）：两者同层（9），
  且 `#toolbar` 在 DOM 里**更靠后**，同层靠后者赢。抽屉打开时工具栏同时 `opacity:0` +
  `pointer-events:none`，避免半透明按钮压在面板滑条上碍事。
- ⚠️ 工具栏仍必须高于遮罩：`.seg` / `.dd-btn` 带 `backdrop-filter:blur()`，各自建立层叠上下文
  并被合成到遮罩之上；工具栏若低于遮罩，抽屉一打开这些按钮就透过遮罩显示成鬼影。
  现在两者同层（工具栏 9 > 遮罩 7），成立。
- ⚠️ `#panelHandle` 的收起位移必须正好是 `translateX(-100%)`：把手 `left:var(--panel-w)` +
  `right:auto`，位移等于抽屉宽时把手恰好落在屏幕 `0..26px`。多减一个把手宽会把它推出屏幕外
  （实测 `left:-25px`，整只手看不见也点不到）。

**冒烟测试**：`test/smoke-mobile.mjs`（54 项）。这组用例的存在理由 —— 上述问题都**不抛异常**，
桌面截图看不出来，只能在具体视口下量：工具栏重叠量、画布 `width/height` 属性比 vs CSS 盒子比、
抽屉开合后的面板盒子位置、参数按钮在工具栏里的**实际排列顺序**、把手在两个状态下的盒位置、
`touch-action` 与 viewport meta 的实际计算值、双指手势的旋转方向与缩放锚点。

⚠️ 双指手势的用例一律走 CDP `Input.dispatchTouchEvent` 派发**真实多指**，不在页面里合成
`TouchEvent`：Chromium 能把坐标喂进 `e.touches`，但 WebKit 里 `new Touch()` 直接抛
`Illegal constructor`，而上线环境正是 WebKit。

⚠️ 量贴图位移时要**先扫出红像素所在的行区间再采样**，不要写死采样行：贴图放大后会收缩，
固定行可能整行落在贴图之外，读到 `-1`（无红像素），断言会以「位移 0」的形式**假通过**。
`smoke-mobile` 为此单独加了一条前置断言。
⚠️ 层级断言用 `elementFromPoint` 判「最顶上元素是否落在 `#panel` 子树内」，而不是比对
`z-index` 数字、也不要要求最顶上正好是 `#panel`（抽屉里有 `details/summary` 等子元素）。

## 6. 易错点

- `padMesh` 与 `wristGroup` 是两个独立对象，不要混淆
- `weldCreased()` 之后必须把 `geo.groups` 原样搬进新几何：顶点焊接不会保留 groups，丢了它顶/边两种材质（导出为 `PadTop` / `PadEdge`）会退化成只有顶面一种。三角形顺序不变，故 `start` / `count` 数值照抄即可（焊接前是顶点单位，焊接后是索引单位，数值相同）
- **新增 UI 参数必须登记三处**：`PARAM_SCHEMA`（导入白名单，缺了会被静默丢弃）、它的 `onChange`（缺了会按最贵的 `rebuild` 处理）、以及形如 `wristTopGap` 这类**几何类滑条**还要给 `slider()` 传 `paramKey`（缺了闸门会退回宽口径）。三处缺任一，启动时控制台都会点名
  - ⚠️ `SLIDER_PARAM` 已从「中文标签 → 参数名」的反查表改成**参数名清单**：做了 i18n 之后标签会随语言变，按标签反查一换语言就查不到，且失效得很安静（闸门悄悄放宽，越界不再被拦）
- **几何入口的异常必须走 `guardedRebuild()`，不要在调用点各自包 `try`**：`rebuild()` 是几何的唯一入口，散落各处的 `try` 会漏掉某条路径（滑条 / 锚点 pointermove / 导入配置 / 启动首次重建），漏掉的表现就是"画面不动且毫无提示"
- ⚠️ 兜底用例**不能只断言"参数回到原值"**：`clampGeoParams()` 单独就能让这类断言变绿，捕获取消了也发现不了。必须同时断言"几何被换回重建前的版本"（越界值真的改变了顶点数，才区分得出"回到了好状态"与"停在坏状态"）
- ⚠️ 冒烟里造"越界参数"要覆写 `input.value` 的 **getter**（返回常量），覆写 setter 无效（浏览器仍按 min/max 夹紧 getter），且用完必须 `delete` 复原，否则后续读取永远拿到常量
- 导出函数（`exportPNG` / `exportModelPNG` / `exportModel3D`）改动渲染器状态时，新代码**必须放进 `try` 块**并由 `finally` 恢复：写在 try 之前的异常不会触发 finally，会让预览永久走形
- 足迹变换**先缩放后旋转**，不可颠倒（3D 局部矩阵是 `T·R·S`）；垫身总长与腕托位置只能取**未旋转**基准 `buildFootprint(_, true)`，否则旋转会带着垫身拉长、腕托平移
- 导入配置的完整同步链：解析 + `cfg.type` 校验 → `sanitizeParams()` 校验 → `resetTexSlot(1/2)` 清空贴图 → `rebuild()` + `refreshShapeUI()` + `refreshWristUI()` + `uiSyncers.forEach()` + `syncTexUI('t1'/'t2')` + `refreshTextures()`
  - ⚠️ `rebuild()` 失败（配置是外部输入，可能注入坏参数）时不要调 `fitEditOrtho()`：按半成品几何算包围盒会把编辑视口缩放到荒谬尺度
  - ⚠️ 清空贴图必须在 `cfg.type` 校验**之后**：否则误选一个普通 JSON 会先清空再报"格式不正确"，把用户已有贴图白白删掉
  - ⚠️ 清空必须**同步**发生在 ZIP 贴图异步回调之前，否则会把刚导入的贴图删掉（竞态）
  - ⚠️ 贴图解码是异步的，成败只能在 `makeTex` 回调里统计；不要在同步流程末尾判断失败数（回调还没跑，恒为 0）
- `applyTexParams()` 只在 `wrap` 变化时置 `t.needsUpdate`：`wrapS/wrapT` 是**采样器参数**，必须随纹理重传才生效；而 `center/repeat/offset/rotation` 只进 `texture.matrix`，每帧由 `refreshTransformUniform` 作 uniform 重算，**不需要**重传。把 `needsUpdate` 无条件加回去，会让拖贴图滑条 / 画布拖拽 / 滚轮缩放时每次输入都重传整张图（4096² RGBA 约 64MB/次）
- 只影响材质、不影响几何的参数**不要 `rebuild()`**：本色与不透明度走 `updateMatBase()`，表面粗糙度走 `updateMatRough()`，边缘颜色走 `updateEdgeColor()`。改这类参数时 `rebuild()` 会白跑 `ExtrudeGeometry` + 腕托球体，还连带 `markShadowDirty()` 重渲深度图
- `makeTex(url, cb, onFail)`：第三参不可省。`FileReader.readAsDataURL` 对任何文件都成功，真实失败发生在 `<img>` 解码阶段，不走 `onerror`
- **本地保存的边界**：`store.saveDraft()` 存的是 `snapshotParams(P)` 的**扁平参数快照**，不是 `{ params }` 包装 —— 恢复时按扁平对象读，并照例过一遍 `sanitizeParams()`
  - ⚠️ 恢复发生在 UI 构建**之后**：不跑一遍 `uiSyncers.forEach()` + `syncTexUI()` 的话，滑条仍显示默认值而画面已经变了（读数与画面对不上）
  - ⚠️ 贴图恢复走 `makeTex()` 而不是直接 `setTex()`：超尺寸图要能弹出裁剪 / 压缩界面，与"用户手动上传"那条路径保持一致
  - ⚠️ 存储失败**绝不**影响调参本身：隐私模式 / 配额满都会抛，存不下只是少一个后悔药
- **切语言是纯 UI 事件**：`applyI18n()` 只改文本，不重建几何、不动参数。任何"切完语言画面变了"都是 bug
- **超尺寸贴图走 `fixOversizeTexture(url, w, h)` 弹窗裁剪 / 压缩，不直接报错**（`makeTex` 内部接入，上传 / 拖拽 / 导入配置三条入口共用）
  - 返回 Promise：resolve(处理后的 dataURL) / reject(用户取消)；取消用 `err.cancelled` 标记，与「文件损坏」区分 —— 调用方据此只给普通提示（`texLoadFailed`），且导入配置时**不计入失败数**
  - **默认 1:1**：不裁不压就按**原图像素**上传，`tfOutputSize()` 只取裁剪区原尺寸、不乘任何缩放。
    旧实现在打开弹窗那一刻就无条件缩到上限边长，用户裁剪框空着也会静默掉一半分辨率
  - **裁剪框决定输出**：「裁多大就出多大」。上限只是**软上限** —— 超了不禁用「应用」，
    只在读数里标红 + 写明"会压缩到上限以内"；真正压缩发生在应用那一步（`tfScale()`），
    保证交给 WebGL 的贴图一定合规（导入配置内嵌贴图等入口也走这里）
  - **长边裁剪滑条单向**：`tfScale()` 只缩不放，往回拉**不会**放大（放大 = 空白像素凭空插值），
    撤销压缩走「1 : 1」按钮（`#tfOrig`），那是唯一的回退出口
  - ⚠️ **滑条刻度（`tf.edge`）是独立状态，绝不写回 `tf.crop`**。旧实现把压缩写回裁剪框，两个后果：
    ①「裁剪」与「压缩」两段读数永远是同一个数（实测 3000×3000 被滑条压成 1024），分段读数白分；
    ② 裁剪框被压小后不可逆，再经滑条回显就成了"往下拉反而变大"的死循环。
    隔离之后两条都自然消失，也不再需要"反推裁剪区"那套把戏
  - 滑条量程 `[1, 原图长边]`。上界**必须**取长边、**不能**取短边：取短边时"1:1"变成一整块
    够不着的死区（3360×4800 的短边 3360 仍超上限，拉到最右也回不到原图）。
    下界**必须**是 1：`min` 属性会被浏览器强制生效，写 4096 的话拖到 1024 会被夹回 4096，滑条成摆设（实测）
  - 读数**分段**：`原图 W × H px`〔→ `裁剪 W × H px`〕〔→ `压缩 W × H px`〕+ 体积量级。
    "裁剪"段取 `tfCropSize()`（裁剪框原像素）、"压缩"段取 `tfFinalSize()`（真正交给 WebGL 的尺寸），
    每段只在**确实变小**时才出现 —— 没裁就没有"裁剪"段，没压就没有"压缩"段，
    用户一眼看出是哪一步动了尺寸。三段式是"两段式 + 二选一句尾提示"的替代品：
    旧写法在本弹窗的常见状态（未裁未压但超限）下，只能把"与原图一致"和"会被自动压缩"挤进同一句
  - ⚠️ 读数标红（`.bad`）看的是**裁剪尺寸**是否超限，不是最终尺寸 —— 最终尺寸被软上限兜底过、
    永远合规，拿它判就再也标不红（实测）
  - `#tfFull`（全选）= 尽可能大；锁着比例时给的是**内接**矩形（3360×4800 锁 1:1 → 3360×3360），
    否则点一下全选就跳出个不满足比例的大框，锁比例等于摆设
  - 状态分两层，勿混：`tf.crop` 是**图片像素坐标**下的裁剪矩形（唯一事实来源），显示层 canvas 按 contain 缩放、裁剪框用 CSS 百分比画在上面；拖拽只在显示坐标量增量再乘 `imgW/dispW` 换回像素
  - ⚠️ 打开弹窗要**先加 `.on` 再量尺寸**：`display:none` 时 `.tf-stage` 的 rect 全为 0，据此算出的显示矩形会把裁剪框压成 2px
  - ⚠️ canvas 的 contain 摆放要内缩 `TF_HANDLE_R`：八个圆形手柄骑在框线上，全选时手柄正压在 `.tf-stage` 边界被 `overflow:hidden` 裁掉一半，`elementFromPoint` 命中框外 → 手柄点不中、拖不动
  - ⚠️ 锁比例时 `tfClampCrop()` 不能对 w / h 各自独立夹取：一边先撞到图片边界就会被夹成不同比例（实测 1:1 变 0.84），必须等比缩到装得下
  - ⚠️ 压缩回调里改 `tf.crop` **不要**走 `tfClampCrop()`：裁剪区一旦超出图内会被它夹回去，
    于是"往下拉反而变大"，再经滑条回显就成了死循环。压缩是等比缩小，落了点也不会出图 —— 不必夹
  - `window.tfState()` 是给冒烟脚本读弹窗内部状态的**只读快照口子**（`crop` / `view` / `imgW/imgH`），
    与 `window.padGeoInfo()` 同一约定：只暴露读，不要在里做写操作
  - 预览图取 `t.image.src` 而非入口 url（`dzPreviewSrc()`）：被裁 / 压过的图要用处理后的那张，否则预览显示的是用户没打算要的原图
- `texControls(el, key, title)` 只存参数名、内部经 `P[key]` 动态取值：**不要在闭包里捕获 `P.t1` / `P.t2` 对象**。导入配置会整体换掉这两个对象，捕获旧引用的控件会写进游离对象（拖动有反应、UI 读数也对，但画面永远不变且不报错）
- `makeTex(url, cb)` 第二参是加载回调；`setDZPreview(dz, ...)` 第一参必须是 DOM 元素
- `📋` 粘贴按钮（`.paste-btn`）是 dropzone 的**兄弟节点**，不能放进 dropzone 内部（`innerHTML` 重写会删掉它）；不要加 `.btn` 类
- 调试前硬刷新（Ctrl+Shift+R），避免用旧版 JS 判定问题
- 腕托与倒角在所有模式下均显示，不存在「退出编辑才出现」的状态

## 7. 仓库结构

```
index.html   页面骨架 + 渲染 / 交互 / 导出（Three.js 经 importmap 从 CDN 加载）
src/         拆出的模块（原生 ES module，零构建），见 §2.5
test/        回归验证，分两层：
  unit/      纯函数级（node:test，约 1 秒）：params / config / textureMath /
             anchors / footprint / i18n；`npm run unit`
  smoke-*.mjs 浏览器冒烟（Playwright + SwiftShader）：smoke-render 渲染交互、
             smoke-export 导出资源、smoke-mobile 移动端布局与触控、
             smoke-texfix 超尺寸贴图处理、smoke-zoomwheel 滚轮方向、
             smoke-i18n-store 国际化与本地保存；`npm run smoke`
  _harness.mjs 公共装置（静态服务 + 浏览器启动 + 断言收集）
demo/        独立 demo 页，与主工程无代码耦合，仅供方案评估，浏览器直接打开即可
  curvetest.html  曲线算法对比（Catmull-Rom 锚点 vs 真贝塞尔手柄）
  sidetest.html   侧边（边缘）方案对比：五种侧壁生成方案 + 纯色/贴图两种观感，不接腕托
server.js    本地静态服务器：node server.js [默认端口 5213]
README.md    项目说明与运行方式
package.json 仅声明 playwright 等调试依赖，运行项目不依赖 npm 包；type=module
Agents.md    本文件
```

**先跑快的**：改纯逻辑先写 `test/unit/` 的断言（毫秒级），只有真需要渲染 / 布局 / 手势
才去动 smoke 脚本。
⚠️ `_harness.mjs` 里 `locale` 固定为 `zh-CN`：i18n 读 `navigator.language` 定初始语言，
不锁住的话所有"按中文文案找控件"的断言会集体失效。
- 调试产物 `snap*.yaml`、`*_diag*`、`*.png`、`server.log` 已在 `.gitignore` 中，不应提交
