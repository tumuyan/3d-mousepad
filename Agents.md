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
| **腕托 cushion** | `wristGroup`（`SphereGeometry` 缩放的椭球） | 鼠标垫上方的软垫可视化，**编辑模式下隐藏**避免遮住 mouse pad 顶面 |
| **编辑模式 / 编辑轮廓** | `curveEdit = true` | 进入经典形状后显示"编辑轮廓（拖拽贝塞尔控制点）"复选框 |
| **正交相机** | `orthoCam`（`OrthographicCamera`） | 编辑模式专用相机，与 `renderer.render` 共用；`shapeToScreen` 也用此相机投影 shape 边界到屏幕 |

## 2. 关键代码定位
- `makeClassicShape()` — 生成经典形状的完整 `THREE.Shape`，上半贝塞尔 + 下半足迹折线
- `setEditOrtho()` — 计算正交视锥：`L/R/T/B` 基于 `makeClassicShape()` 真实 bbox，中心对齐 shape 几何中心
- `shapeToScreen(shapeX, shapeY)` — 把 shape 2D 坐标投影到屏幕像素，矩阵来源与 3D 渲染相同
- `drawCurveOverlay()` — 编辑模式下在 `curveLayer` 画蓝色控制曲线（投影 `makeClassicShape` 完整轮廓）+ 锚点/手柄
- `buildPad()` — `P.shape === 'classic'` 时调用 `makeClassicShape()` 构建 `padMesh`（编辑态 `bevelEnabled:false`，顶面在世界 Y = `P.thick/2`）
- `buildWrist(topY)` — 构建腕托 cushion，**`wristGroup.visible = !curveEdit`** 编辑模式自动隐藏
- `setCurveEdit(on)` — 进入/退出编辑模式，切换 `curveEdit`、`wristGroup.visible`、`controls.enabled`、覆盖层显示
- `classicCtrl`（即 `P.classicCtrl`）— 上半贝塞尔锚点链数组，结构 `[{ x, y, h1:{x,y}, h2:{x,y}, pin?:true }]`
- `bakeClassicCtrl` / `ensureClassicCtrl` / `autoSmoothClassicCtrl` — 锚点链的烘焙 / 复用 / 平滑函数

## 3. 视觉一致性原则
- 蓝色控制曲线 = `makeClassicShape()` 完整投影 = `padMesh` 顶面 = 鼠标垫 3D 渲染外形，三者**严格 1:1 重合**（数学保证：同一相机同一矩阵同一 shape）
- 鼠标垫颜色（材质色、贴图）由 `P.t1 / P.t2 / P.baseColor / P.padColor` 等参数控制；为方便调试，用户已指示将鼠标垫**整体着色为黄色**，与蓝色控制曲线形成高对比
- 编辑模式下**不显示**腕托 cushion，避免其高出顶面的部分遮住真实鼠标垫外形
- 退出编辑模式后，鼠标垫恢复完整外观（含腕托 cushion）

## 4. 修改/调试注意事项
- **不要**在浏览器跑老版本 JS 后判定 bug；项目已加 `<meta http-equiv="Cache-Control" content="no-cache">`，但用户硬刷新（Ctrl+Shift+R）才能确保拿到最新代码
- **不要**把 `padMesh` 顶面与 `wristGroup` cushion 混淆；cushion 是 `SphereGeometry`，顶面 `padMesh` 是 `ExtrudeGeometry`，**两个独立对象**
- 修改 `setEditOrtho` 后需要让 `rebuild()` / `resize()` / 用户操作触发重新计算，否则视锥用旧值
- `shapeToScreen` 与 `renderer.render(scene, orthoCam)` 始终用同一 `orthoCam` 对象，保证 1:1
- 经典形状模式在代码中用英文值 `'classic'`，**不要使用 `hug`**（用户要求此模式叫"经典"）
