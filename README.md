# 3D MousePad Studio

基于 Three.js 的浏览器端3d鼠标垫设计工具，所有参数实时调节，支持远超市售客制化3d鼠标垫的外形参数，供爱好者玩耍。

## 运行

直接用浏览器打开 `index.html` 即可（无需服务器 / 构建步骤）。

```bash
# 若浏览器对本地模块有限制，可用任意静态服务器打开
npx serve .      # 然后访问提示的地址
# 或直接 python
python -m http.server 8000
```

> 依赖通过 CDN（importmap）加载，需要联网首次加载。

## 主要功能

- **外形（shape）**：经典（hug，贴合腕托）、椭圆、圆角矩形、跑道形。
- **腕托（wristStyle）**：整体腕托（肾形变形）、双球、无。
- **鼠标垫超出腕托（wMargin）**：控制垫面相对腕托外扩的距离。
- **腰窝 / 顶部不对称**：通过左右腰凹深、侧切陡度、顶部不对称等滑条微调经典外形。
- **材质 / 贴图**：底色、不透明度、表面粗糙度，以及贴图（cover / cutout）混合。
- **灯光 / 背景 / 导出**：方向光、环境光、背景颜色、透明背景、导出倍率。

## 代码结构（index.html 内联）

- `makeShape()`：根据 `P.shape` 生成 `THREE.Shape`。
- `makeHugShape()`：经典款轮廓，底部严格沿腕托几何体（与 3D mesh 同一套变形）法向外扩 `wMargin`。
- `wristFootprint(kind, opts)`：采样腕托原始足迹（full / ball / none）。
- `offsetFootprint(raw)`：沿法向偏移 `wMargin` 得到垫面底边。
- `buildPad()` / `buildWrist()`：构建并刷新 3D 网格。
- `updateMatBase()`：实时更新材质底色 / 透明度（切换透明时触发 shader 重编译）。

## 参数说明（部分）

| 参数 | 含义 |
| --- | --- |
| `wMargin` | 鼠标垫外形相对腕托外扩量 |
| `waistLDepth` / `waistRDepth` | 左 / 右腰窝凹深 |
| `waistRound` | 腰窝弧线圆润度 |
| `sideCut` | 侧切陡度（0 柔和，1 接近直线） |
| `topAsym` | 顶部左右不对称 |
| `matOpacity` | 底色不透明度 |

## 备注

- 改完参数后几何会重建（`rebuild()`），材质颜色 / 透明度等仅实时更新、不重建几何。
- 导出图片使用 `preserveDrawingBuffer`，建议通过界面内“导出”按钮保存。
