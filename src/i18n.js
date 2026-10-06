/* 国际化：界面文案的唯一出处。
   页面上不再出现任何硬编码中文 —— HTML 里的静态文案由 `data-i18n` 标记，
   JS 里生成的文案一律走 `t(key)`。

   ⚠️ 只有同一份文本需要两种语言时才进词典。调试日志、纯开发用的注释不进。
   ⚠️ 新增用户可见文案时**必须**同时补 zh 与 en 两份，缺词时 `t()` 会回退成 key 本身
   （界面上出现 `panel.shape` 这种原始 key，比翻译成一半更难看，是刻意的显眼失败）。 */

const DICT = {
  zh: {
    // —— 面板骨架 ——
    // ⚠️ 标题拆成两段而不是一整句 + <span> 高亮：applyI18n() 对 data-i18n 走
    //    textContent 赋值，会把高亮用的 <span> 一并冲掉，粉色强调只在首屏存在。
    'app.titleA': '3D MousePad', 'app.titleB': 'Studio',
    'panel.texture': '贴图',
    'panel.shape': '鼠标垫外形',
    'panel.wrist': '腕托',
    'panel.light': '光照',
    'panel.export': '背景与导出',
    'panel.debug': '调试',

    // —— 贴图 ——
    'tex.drop1': '点击上传主贴图<br><small>或拖拽图片到画布</small>',
    'tex.drop2': '点击上传腕托贴图（可选）<br><small>上传后将覆盖腕托区域</small>',
    'tex.hint': '提示：直接把图片文件拖到右侧画布也可上传（自动填入空位）。点击左侧「粘贴」按钮，可将剪贴板中的图片填入对应槽位（不经过预览区）。',
    'tex.group1': '— 主贴图变换 —',
    'tex.group2': '— 腕托贴图变换 —',
    'tex.main': '主贴图',
    'tex.wrist': '腕托贴图',
    'tex.pasteTitle': '粘贴剪贴板图片',
    'tex.pasteUnsupported': '当前浏览器不支持主动读取剪贴板，请改用文件上传或拖拽。',
    'tex.pasteEmpty': '剪贴板中没有图片。',
    'tex.pasteFailed': '无法读取剪贴板：{msg}（需用户已授权剪贴板读取权限）',
    'tex.readFailed': '读取文件失败：{msg}',
    'tex.loadFailed': '贴图加载失败：{msg}',
    'tex.lineFailed': '{name}加载失败，未应用：{msg}',
    'tex.cancelled': '{name}未应用：已取消处理超尺寸图片',
    'tex.fileHint': '文件可能已损坏或不是受支持的图片格式',

    // —— 贴图变换控件 ——
    'ctl.wrap': '重复模式', 'ctl.scale': '缩放', 'ctl.aspect': '长宽比',
    'ctl.offsetX': '偏移 X', 'ctl.offsetY': '偏移 Y', 'ctl.rotate': '旋转°',
    'wrap.clamp': '不重复·边缘延伸', 'wrap.cutout': '不重复',
    'wrap.repeat': '重复', 'wrap.mirror': '镜像重复',

    // —— 外形 ——
    'ctl.shape': '轮廓',
    'shape.rect': '圆角矩形', 'shape.ellipse': '椭圆',
    'shape.stadium': '胶囊形', 'shape.classic': '经典',
    'ctl.padW': '基础宽度', 'ctl.padH': '基础长度', 'ctl.corner': '圆角',
    'ctl.wristTopGap': '腕托顶距', 'ctl.curveEdit': '编辑轮廓', 'ctl.wMargin': '外形超出腕托',
    'ctl.thick': '基础厚度', 'ctl.bevel': '边缘倒角',
    'ctl.edgeSame': '边缘随正面整体着色', 'ctl.edgeColor': '边缘颜色',
    'ctl.rough': '表面粗糙', 'ctl.matColor': '材质底色',
    'ctl.matOpacity': '本色不透明度', 'ctl.texOpacity': '贴图不透明度',
    'btn.resetAnchors': '重置锚点', 'btn.resetAnchorsTitle': '把全部锚点恢复为默认轮廓',
    'btn.fitView': '适应视图',
    'btn.fitViewTitle': '重新缩放平移，使整个轮廓回到画面中（拖动锚点时视口保持不变）',
    'note.padW': '轮廓宽度（mm）。成品外廓 = 该值 + 1.8 × 边缘倒角',
    'note.padH': '轮廓长度（mm）。成品外廓 = 该值 + 1.8 × 边缘倒角',
    'note.thick': '中间平板厚度（mm）。成品总厚 = 该值 + 2 × 边缘倒角',
    'note.bevel': '边缘圆角半径（mm）。会让成品外廓每边外扩 0.9 × 该值、上下各加厚该值',

    // —— 腕托 ——
    'ctl.wristStyle': '款式',
    'wrist.none': '无腕托', 'wrist.full': '整体腕托', 'wrist.balls': '双球腕托',
    'ctl.wH': '隆起高度', 'ctl.wW': '腕托宽度', 'ctl.wMorph': '肾形程度',
    'ctl.wMorphRot': '腕托旋转°', 'ctl.wBW': '单球宽度', 'ctl.wRot': '双球旋转°',
    'ctl.wEgg': '鹅蛋度', 'ctl.wJoin': '双球过渡弧', 'ctl.wD': '前后长度',
    'ctl.wGap': '双球间距', 'ctl.wPos': '距底边',

    // —— 光照 ——
    'ctl.hemi': '环境光', 'ctl.key': '主光强度', 'ctl.az': '主光方位',
    'ctl.el': '主光高度', 'ctl.lightColor': '灯光颜色', 'ctl.env': '环境反射',
    'ctl.shadow': '地面阴影',

    // —— 背景与导出 ——
    'ctl.transparent': '透明背景', 'ctl.bg': '背景颜色',
    'ctl.exportTransparent': '导出时透明背景', 'ctl.exportScale': '导出倍率',
    'ctl.exportHeader': '导出图署名条', 'ctl.exportHeaderTransparent': '署名条留空底',
    'ctl.cfgName': '配置名称', 'ctl.cfgNamePh': '留空则用默认文件名',
    'btn.exportPreview': '导出预览图', 'btn.exportModelPNG': '导出模型渲染图',
    'btn.exportGLB': '导出模型 (GLB，含贴图)', 'btn.exportSTL': '导出模型 (STL，打印)',
    'btn.exportOBJ': '导出模型 (OBJ)',
    'btn.exportCfgJson': '导出配置 (JSON)', 'btn.exportCfgZip': '导出配置 (ZIP，含贴图)',
    'btn.importCfg': '导入配置 (JSON / ZIP)',
    // 导出区分组的小标题（分组是为了让 8 个导出入口有主次，见 index.html 的 .btn-cap）
    'export.capModel': '3D 模型', 'export.capCfg': '配置文件',

    // —— 调试 ——
    'ctl.dbgRebuild': 'rebuild 耗时打到控制台', 'ctl.dbgReset': '统计清零', 'btn.clear': '清空',
    'dbg.cleared': '[rebuild] 统计已清零',

    // —— 工具栏 ——
    'tb.exportImg': '导出图片', 'tb.exportModel': '导出模型', 'tb.config': '配置',
    'tb.previewPng': '预览图 (PNG)', 'tb.modelPng': '渲染图 (PNG)',
    'tb.glb': '3D 模型 (GLB，含贴图)', 'tb.stl': '3D 模型 (STL，打印)', 'tb.obj': '3D 模型 (OBJ)',
    'tb.cfgJson': '导出配置 (JSON)', 'tb.cfgZip': '导出配置 (ZIP)', 'tb.cfgImport': '导入配置…',
    'tb.params': '⚙ 参数', 'tb.collapse': '▸ 收起',
    'mode.view': '视角', 'mode.t1': '主贴图', 'mode.t2': '腕托贴图',
    'view.persp': '透视', 'view.top': '顶视', 'view.front': '前视',
    'lang.switch': 'English',

    // —— 交互提示 ——
    'hint.texMode': '正在编辑{name}：拖拽=移动  滚轮=缩放  Shift+滚轮=旋转',
    'hint.curveMode': '编辑轮廓：拖圆点=移动锚点  拖方块=调切线  Shift=切线独立  双击=加点  右键=删点',
    'hint.drop': '松开以上传图片',

    // —— 超尺寸贴图弹窗 ——
    'tf.title': '调整贴图尺寸',
    // 说明段落里嵌着两个**运行时数字**（原图尺寸与上限），不能整段进词典 ——
    // 那会让切语言时把承载数字的 <span> 一起冲掉。故拆成"数字前 / 中 / 后"三段纯文本 + 一句带 <b> 的提示。
    'tf.descPre': '这张图片为',
    'tf.descMid': '，可用边长上限为',
    'tf.descPost': '。',
    'tf.descTip': '<b>裁剪框</b>决定保留多大，<b>长边裁剪</b>只把图压小；仍超过上限时自动等比压缩到上限以内。',
    'tf.aspect': '裁剪比例', 'tf.aspectFree': '自由', 'tf.selectAll': '全选',
    'tf.longEdge': '长边裁剪', 'tf.orig': '1 : 1', 'tf.format': '输出格式',
    'tf.formatPng': 'PNG（无损，保留透明）', 'tf.formatJpeg': 'JPEG（体积更小）',
    'tf.quality': 'JPEG 质量', 'tf.cancel': '取消上传', 'tf.apply': '应用并上传',
    'tf.readout': '原图 <b>{iw} × {ih}</b> px',
    'tf.cut': ' → 裁剪 <b>{w} × {h}</b> px',
    'tf.squeeze': ' → 压缩 <b>{w} × {h}</b> px，{est}',
    'tf.est': '，{est}', 'tf.period': '。',
    'tf.autoShrink': '；超过 <b>{max} × {max}</b> px，应用时会自动压缩到上限以内',
    'tf.estMb': '约 <b>{v} MB</b>', 'tf.estKb': '约 <b>{v} KB</b>',
    'tf.processFailed': '图片处理失败：{msg}',

    // —— 配置导入 / 导出 ——
    'cfg.tooBig': '配置文件过大（{mb}MB），上限 32MB',
    'cfg.failed': '配置导入失败：{msg}',
    'cfg.badFormat': '配置导入失败：文件格式不正确',
    'cfg.version': '配置版本为 v{v}（当前支持 v{cur}），已尝试导入',
    'cfg.importedWarn': '配置已导入，但部分字段无效已回退默认：{keys}{more}',
    'cfg.importedTexFail': '配置已导入，但有 {n} 张贴图加载失败',
    'cfg.imported': '配置已导入',
    'cfg.importFailed': '导入失败：{msg}',
    'cfg.texCancelled': '配置中的{name}未应用：已取消处理超尺寸图片',
    'cfg.texFailed': '配置中的{name}加载失败（文件可能已损坏）',
    'cfg.more': ' 等',
    'cfg.unknownErr': '未知错误',
    'cfg.unknown': '未知字段 {keys}{more}',
    'cfg.warnLog': '[配置校验] 以下参数未登记 PARAM_SCHEMA，导入时会被丢弃：',

    // —— 导出 ——
    'exp.modelNotReady': '模型尚未构建，无法导出',
    'exp.previewFailed': '预览图导出失败：{msg}',
    'exp.modelPngFailed': '模型渲染图导出失败：{msg}',
    'exp.glbDoing': '正在生成 GLB…',
    'exp.glbDone': '已导出 GLB（含材质与贴图，1 单位 = 1m）',
    'exp.stlDone': '已导出 STL（仅几何，1 单位 = 1mm）',
    'exp.objDone': '已导出 OBJ（仅几何、无材质，1 单位 = 1mm）',
    'exp.modelFailed': '模型导出失败：{msg}',

    // —— 几何兜底 ——
    'geo.rollback': '几何重建失败：{where}已回退到上一个可用参数（{msg}）',
    'geo.rollbackWhere': '参数 {keys}{more} 越界，',
    'geo.reset': '几何重建失败，已恢复默认参数：{msg}{where}',
    'geo.resetWhere': '（参数 {keys}{more} 越界）',
    'geo.clamped': '已收敛超出范围的几何参数：{keys}{more}',

    // —— 方案槽位（本地保存） ——
    'save.autosave': '自动草稿',
    'save.saved': '已保存为「{name}」',
    'save.restored': '已恢复上次的设计草稿',
    'save.restoredSlot': '已载入方案「{name}」',
    'save.cleared': '已清空本地方案',
    'save.empty': '还没有保存任何方案',
    'save.namePh': '方案名称',
    'save.btn': '保存',
    'save.loadBtn': '载入',
    'save.delBtn': '删除',
    'save.slot': '方案槽位',
    'save.autosaveHint': '参数改动会自动存为草稿，刷新页面后恢复。',
    'save.confirmDel': '确定删除方案「{name}」？',
    'save.loadFailed': '方案载入失败：{msg}',
    'save.saveFailed': '方案保存失败：{msg}',
    'save.noTex': '（不含贴图）',

    // —— 无障碍标签 ——
    'aria.openPanel': '打开参数面板', 'aria.closePanel': '收起参数面板',
    'aria.expandPanel': '展开参数面板',
    'aria.panelHandle': '展开 / 收起参数面板',
    'aria.params': '参数面板',
  },

  en: {
    'app.titleA': '3D MousePad', 'app.titleB': 'Studio',
    'panel.texture': 'Texture',
    'panel.shape': 'Pad Shape',
    'panel.wrist': 'Wrist Rest',
    'panel.light': 'Lighting',
    'panel.export': 'Background & Export',
    'panel.debug': 'Debug',

    'tex.drop1': 'Click to upload the main texture<br><small>or drop an image on the canvas</small>',
    'tex.drop2': 'Click to upload a wrist-rest texture (optional)<br><small>it covers the wrist rest area</small>',
    'tex.hint': 'Tip: you can also drag an image file straight onto the canvas (it fills an empty slot). The 📋 button pastes an image from the clipboard into the matching slot.',
    'tex.group1': '— Main texture transform —',
    'tex.group2': '— Wrist texture transform —',
    'tex.main': 'main texture',
    'tex.wrist': 'wrist texture',
    'tex.pasteTitle': 'Paste image from clipboard',
    'tex.pasteUnsupported': 'This browser cannot read the clipboard; please upload or drop a file instead.',
    'tex.pasteEmpty': 'No image on the clipboard.',
    'tex.pasteFailed': 'Cannot read the clipboard: {msg} (clipboard permission required)',
    'tex.readFailed': 'Failed to read the file: {msg}',
    'tex.loadFailed': 'Texture failed to load: {msg}',
    'tex.lineFailed': '{name} not applied: {msg}',
    'tex.cancelled': '{name} not applied: oversized image processing was cancelled',
    'tex.fileHint': 'the file may be corrupt or not a supported image format',

    'ctl.wrap': 'Wrap mode', 'ctl.scale': 'Scale', 'ctl.aspect': 'Aspect',
    'ctl.offsetX': 'Offset X', 'ctl.offsetY': 'Offset Y', 'ctl.rotate': 'Rotate°',
    'wrap.clamp': 'no repeat · clamp edge', 'wrap.cutout': 'no repeat · cut out',
    'wrap.repeat': 'repeat', 'wrap.mirror': 'mirrored repeat',

    'ctl.shape': 'Outline',
    'shape.rect': 'Rounded rect', 'shape.ellipse': 'Ellipse',
    'shape.stadium': 'Stadium', 'shape.classic': 'Classic',
    'ctl.padW': 'Base width', 'ctl.padH': 'Base length', 'ctl.corner': 'Corner radius',
    'ctl.wristTopGap': 'Rest→top gap', 'ctl.curveEdit': 'Edit outline', 'ctl.wMargin': 'Overhang',
    'ctl.thick': 'Base thickness', 'ctl.bevel': 'Edge bevel',
    'ctl.edgeSame': 'Edge shares top color', 'ctl.edgeColor': 'Edge color',
    'ctl.rough': 'Roughness', 'ctl.matColor': 'Base color',
    'ctl.matOpacity': 'Base opacity', 'ctl.texOpacity': 'Texture opacity',
    'btn.resetAnchors': 'Reset anchors', 'btn.resetAnchorsTitle': 'Restore every anchor to the factory outline',
    'btn.fitView': 'Fit view',
    'btn.fitViewTitle': 'Zoom and pan so the whole outline is back on screen (the viewport never moves while dragging)',
    'note.padW': 'Outline width (mm). Finished outline = this value + 1.8 × edge bevel',
    'note.padH': 'Outline length (mm). Finished outline = this value + 1.8 × edge bevel',
    'note.thick': 'Core slab thickness (mm). Finished thickness = this value + 2 × edge bevel',
    'note.bevel': 'Edge radius (mm). Expands the outline by 0.9 × this value per side and adds it top and bottom',

    'ctl.wristStyle': 'Style',
    'wrist.none': 'None', 'wrist.full': 'One piece', 'wrist.balls': 'Two balls',
    'ctl.wH': 'Height', 'ctl.wW': 'Rest width', 'ctl.wMorph': 'Kidney',
    'ctl.wMorphRot': 'Rest rotate°', 'ctl.wBW': 'Ball width', 'ctl.wRot': 'Ball rotate°',
    'ctl.wEgg': 'Egg shape', 'ctl.wJoin': 'Bridge', 'ctl.wD': 'Depth',
    'ctl.wGap': 'Ball spacing', 'ctl.wPos': 'From bottom',

    'ctl.hemi': 'Ambient', 'ctl.key': 'Key light', 'ctl.az': 'Key azimuth',
    'ctl.el': 'Key elevation', 'ctl.lightColor': 'Light color', 'ctl.env': 'Env reflection',
    'ctl.shadow': 'Ground shadow',

    'ctl.transparent': 'Transparent bg', 'ctl.bg': 'Background',
    'ctl.exportTransparent': 'Transparent bg on export', 'ctl.exportScale': 'Export scale',
    'ctl.exportHeader': 'Export header bar', 'ctl.exportHeaderTransparent': 'Header keeps no fill',
    'ctl.cfgName': 'Config name', 'ctl.cfgNamePh': 'blank = default file name',
    'btn.exportPreview': 'Export preview image', 'btn.exportModelPNG': 'Export model render',
    'btn.exportGLB': 'Export GLB (with texture)', 'btn.exportSTL': 'Export STL (for printing)',
    'btn.exportOBJ': 'Export OBJ',
    'btn.exportCfgJson': 'Export config (JSON)', 'btn.exportCfgZip': 'Export config (ZIP, with textures)',
    'btn.importCfg': 'Import config (JSON / ZIP)',
    'export.capModel': '3D model', 'export.capCfg': 'Config file',

    'ctl.dbgRebuild': 'Log rebuild timings to console', 'ctl.dbgReset': 'Reset stats', 'btn.clear': 'Clear',
    'dbg.cleared': '[rebuild] stats cleared',

    'tb.exportImg': 'Export image', 'tb.exportModel': 'Export model', 'tb.config': 'Config',
    'tb.previewPng': 'Preview (PNG)', 'tb.modelPng': 'Render (PNG)',
    'tb.glb': 'GLB (with texture)', 'tb.stl': 'STL (for printing)', 'tb.obj': 'OBJ',
    'tb.cfgJson': 'Export config (JSON)', 'tb.cfgZip': 'Export config (ZIP)', 'tb.cfgImport': 'Import config…',
    'tb.params': '⚙ Params', 'tb.collapse': '▸ Hide',
    'mode.view': 'View', 'mode.t1': 'Main tex', 'mode.t2': 'Wrist tex',
    'view.persp': 'Persp', 'view.top': 'Top', 'view.front': 'Front',
    'lang.switch': '中文',

    'hint.texMode': 'Editing {name}: drag = move, wheel = zoom, Shift+wheel = rotate',
    'hint.curveMode': 'Editing outline: drag dot = move anchor, drag square = tangent, Shift = free tangent, double click = add, right click = delete',
    'hint.drop': 'Release to upload',

    'tf.title': 'Adjust texture size',
    'tf.descPre': 'This image is',
    'tf.descMid': '; the usable edge limit is',
    'tf.descPost': '.',
    'tf.descTip': 'The <b>crop box</b> decides how much is kept, <b>long edge</b> only shrinks it; anything still over the limit is scaled down to fit.',
    'tf.aspect': 'Crop ratio', 'tf.aspectFree': 'Free', 'tf.selectAll': 'Select all',
    'tf.longEdge': 'Long edge', 'tf.orig': '1 : 1', 'tf.format': 'Output format',
    'tf.formatPng': 'PNG (lossless, keeps alpha)', 'tf.formatJpeg': 'JPEG (smaller file)',
    'tf.quality': 'JPEG quality', 'tf.cancel': 'Cancel upload', 'tf.apply': 'Apply & upload',
    'tf.readout': 'source <b>{iw} × {ih}</b> px',
    'tf.cut': ' → cropped <b>{w} × {h}</b> px',
    'tf.squeeze': ' → downscaled <b>{w} × {h}</b> px, {est}',
    'tf.est': ', {est}', 'tf.period': '.',
    'tf.autoShrink': '; over <b>{max} × {max}</b> px, it is scaled down to the limit on apply',
    'tf.estMb': 'about <b>{v} MB</b>', 'tf.estKb': 'about <b>{v} KB</b>',
    'tf.processFailed': 'Image processing failed: {msg}',

    'cfg.tooBig': 'Config file too large ({mb}MB); the limit is 32MB',
    'cfg.failed': 'Config import failed: {msg}',
    'cfg.badFormat': 'Config import failed: wrong file format',
    'cfg.version': 'Config version is v{v} (this build supports v{cur}); imported anyway',
    'cfg.importedWarn': 'Config imported, but some fields were invalid and fell back to defaults: {keys}{more}',
    'cfg.importedTexFail': 'Config imported, but {n} texture(s) failed to load',
    'cfg.imported': 'Config imported',
    'cfg.importFailed': 'Import failed: {msg}',
    'cfg.texCancelled': 'The {name} in this config was not applied: oversized image processing was cancelled',
    'cfg.texFailed': 'The {name} in this config failed to load (the file may be corrupt)',
    'cfg.more': ' etc.',
    'cfg.unknownErr': 'unknown error',
    'cfg.unknown': 'unknown field(s) {keys}{more}',
    'cfg.warnLog': '[config] these params are not in PARAM_SCHEMA and will be dropped on import:',

    'exp.modelNotReady': 'The model is not built yet, nothing to export',
    'exp.previewFailed': 'Preview export failed: {msg}',
    'exp.modelPngFailed': 'Model render export failed: {msg}',
    'exp.glbDoing': 'Building GLB…',
    'exp.glbDone': 'GLB exported (materials and texture included, 1 unit = 1m)',
    'exp.stlDone': 'STL exported (geometry only, 1 unit = 1mm)',
    'exp.objDone': 'OBJ exported (geometry only, no material, 1 unit = 1mm)',
    'exp.modelFailed': 'Model export failed: {msg}',

    'geo.rollback': 'Geometry rebuild failed: {where}rolled back to the last usable parameters ({msg})',
    'geo.rollbackWhere': 'parameter(s) {keys}{more} out of range, ',
    'geo.reset': 'Geometry rebuild failed, defaults restored: {msg}{where}',
    'geo.resetWhere': ' (parameter(s) {keys}{more} out of range)',
    'geo.clamped': 'Geometry parameters clamped into range: {keys}{more}',

    'save.autosave': 'Auto draft',
    'save.saved': 'Saved as “{name}”',
    'save.restored': 'Restored the previous design draft',
    'save.restoredSlot': 'Loaded design “{name}”',
    'save.cleared': 'Local designs cleared',
    'save.empty': 'No saved designs yet',
    'save.namePh': 'Design name',
    'save.btn': 'Save',
    'save.loadBtn': 'Load',
    'save.delBtn': 'Delete',
    'save.slot': 'Saved designs',
    'save.autosaveHint': 'Changes are kept as an auto draft and restored after a reload.',
    'save.confirmDel': 'Delete design “{name}”?',
    'save.loadFailed': 'Failed to load the design: {msg}',
    'save.saveFailed': 'Failed to save the design: {msg}',
    'save.noTex': '(no texture)',

    'aria.openPanel': 'Open the parameter panel', 'aria.closePanel': 'Collapse the parameter panel',
    'aria.expandPanel': 'Expand the parameter panel',
    'aria.panelHandle': 'Expand / collapse the parameter panel',
    'aria.params': 'Parameter panel',
  },
};

export const LANGS = Object.keys(DICT);
const STORE_KEY = '3dm.lang';

let lang = 'zh';
const listeners = new Set();

// 浏览器初始值：localStorage → navigator.language → zh。
// 只在模块首次求值时读一次 DOM / storage，之后由 setLang() 显式驱动。
export function initLang(storage) {
  let saved = null;
  try { saved = storage && storage.getItem(STORE_KEY); } catch (e) { /* 隐私模式下 getItem 会抛 */ }
  if (saved && DICT[saved]) lang = saved;
  else if (typeof navigator !== 'undefined') {
    const nav = (navigator.language || '').toLowerCase();
    if (nav && !nav.startsWith('zh')) lang = 'en';
  }
  return lang;
}
export const getLang = () => lang;
export const otherLang = () => (lang === 'zh' ? 'en' : 'zh');
// 切换语言的按钮文案 = 目标语言自己的名字（中文界面上显示 English，反之显示 中文）
export const langSwitchLabel = () => DICT[otherLang()]['lang.switch'];

export function setLang(next, storage) {
  if (!DICT[next] || next === lang) return lang;
  lang = next;
  try { storage && storage.setItem(STORE_KEY, next); } catch (e) { /* 配额满 / 隐私模式：不阻断切换 */ }
  listeners.forEach(f => f(lang));
  return lang;
}
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// 取一条文案。缺词时返回 key 本身 —— 界面上冒出 `panel.shape` 比半截翻译更显眼。
export function has(key) { return Object.prototype.hasOwnProperty.call(DICT[lang] || {}, key); }
// 词典词条清单（只读）。给测试与调试用：靠它可以断言两种语言的 key 完全一致，
// 不必把整个 DICT 导出（外部只该走 t()，直接读词典就能绕过缺词回退）。
export const keysOf = l => Object.keys(DICT[l] || {});
export function t(key, vars) {
  const raw = (DICT[lang] || {})[key];
  if (raw === undefined) return key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
// 给一段由若干词条拼起来的文本用：先替换占位符，再逐条取词
export const fmt = (key, vars) => t(key, vars);
