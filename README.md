# NyxBot Plugins

NyxBot 插件市场索引仓库。本仓库只存储 `plugin-index.json` 索引文件，不托管插件 jar 二进制——jar 由插件作者在自己的 GitHub Release 发布。

## 两种 Issue 模板

| 模板 | 用途 | 触发工作流 |
|------|------|-----------|
| [插件提交](../../issues/new?assignees=&labels=plugin-submission&template=plugin-submission.yml) | 收录一个**新插件** | `plugin-submission.yml` |
| [插件更新](../../issues/new?assignees=&labels=plugin-update&template=plugin-update.yml) | 为**已收录**插件添加新版本 | `plugin-update.yml` |

## 新增插件流程

1. 在你的插件仓库发布一个 GitHub Release（含 `.jar` 资产）
2. 点击「插件提交」模板，填写插件信息（名称、作者、仓库等）
   - **版本号和下载地址无需填写**——工作流自动从你仓库的最新 Release 获取
   - `fileSize` / `sha256` 也由工作流自动计算
3. 提交 issue 后，GitHub Actions 自动执行：
   - 验证 `repository` 公开可访问
   - 调用 GitHub API 获取最新 Release，从 `tag_name` 提取版本号
   - 从 Release 资产中找 `.jar`，下载并计算 SHA-256 与文件大小
   - 校验插件名唯一性（不与已有插件重名）
4. 校验通过 → 自动创建 PR（含校验报告），等待仓库 owner 审核合并
5. 校验失败 → 自动在 issue 评论失败原因并打上 `invalid` 标签

## 更新插件流程

1. 在你的插件仓库发布一个新的 GitHub Release（含 `.jar` 资产）
2. 点击「插件更新」模板，只需填写**插件标识名**
   - `repository` 从索引读取（不允许在 issue 中覆盖，防冒充）
   - 版本号、jar 下载地址、校验信息全部自动获取
3. 工作流自动执行：
   - 校验插件已存在于索引
   - 从索引读取 `repository`，查最新 Release
   - 校验新版本号不在 `versions` 字典中（防重复收录）
   - 下载 jar 计算 SHA-256 / fileSize
4. 校验通过 → 自动创建 PR，等待审核
5. 合并后自动关闭关联 issue

## 多 jar 资产处理

如果你的 Release 包含多个 `.jar` 文件，工作流无法自动判断用哪个。此时请在 issue 表单的「jar 资产名」字段填写准确的文件名（如 `draw-alerts-1.0.0.jar`）。单个 `.jar` 时留空即可。

## 索引结构

详见 NyxBot 主仓库的 `PluginIndex` / `PluginIndexEntry` / `PluginVersionEntry` 数据类。

```json
{
  "schemaVersion": "1.0",
  "marketplace": "nyxbot-plugins",
  "updatedAt": "ISO 8601 时间",
  "plugins": {
    "plugin-name": {
      "name": "plugin-name",
      "displayName": "展示名",
      "description": "描述",
      "author": "GitHub用户名",
      "type": "jar",
      "repository": "owner/repo",
      "license": "MIT",
      "homepage": "URL",
      "iconUrl": "URL",
      "tags": ["draw"],
      "versions": {
        "1.0.0": {
          "downloadUrl": "GitHub Release 直链（自动获取）",
          "fileSize": 12345,
          "sha256": "hex校验和（自动计算）",
          "requires": ">=21",
          "releaseNotes": "发布说明（取自 Release body）"
        }
      }
    }
  }
}
```

## native 插件说明

native 类型插件（含 JNA 原生库）**不走市场自动分发**。本仓库只登记 native 插件的元数据（名称、作者、仓库等），`downloadUrl` 指向作者仓库的 Release 页面，供用户手动下载。

### 为什么 native 不自动分发

主仓库的 `DrawImagePluginManager.loadPlugins("./plugin")` 扫描 `./plugin/` 目录，按文件后缀分流：

- `.jar` → `URLClassLoader` + `ServiceLoader` 加载（纯 Java 插件，可自动下载安装）
- `.dll` / `.so` / `.dylib` → 直接传文件绝对路径给 `JnaNativePluginLoader` → `Native.load(absolutePath, NativeDrawLibrary.class)` 按路径加载

native 插件是**裸的动态库文件**，不是 jar——主仓库 `install()` 硬编码 `.jar` 后缀，无法下载原生库文件到 `./plugin/` 目录。因此 native 插件需要用户手动部署。

### native 插件部署流程

1. 从插件的 GitHub Release 下载对应平台的原生库文件：
   - Windows：`xxx.dll`
   - Linux：`libxxx.so`
   - macOS：`libxxx.dylib`
2. 手动拷贝到 NyxBot 的 `./plugin/` 目录
3. 重启 NyxBot 或通过 Web 管理后台触发热重载

### native 插件提交到市场

提交 native 插件时，issue 表单的 `type` 选 `native`，`repository` 填插件源码仓库。索引中会记录插件元数据，`downloadUrl` 指向作者仓库的最新 Release 页面（供用户跳转手动下载），不参与自动安装。

### 参考实现

native 插件的 JNA 接口定义和适配器实现可参考主仓库作者的外部库：

- 仓库：`KingPrimes/DrawImagePlugin`
- JNA 接口：`NativeDrawLibrary`（`draw-image-plugin-native-jna` 模块）
- 适配器：`JNADrawPluginAdapter`
- 加载器：`JnaNativePluginLoader`

native 端需实现 `NativeDrawLibrary` 接口的所有 `native*` 方法，编译为动态库后在 Java 端通过 JNA 桥接调用。

## CDN 访问

`plugin-index.json` 通过 jsDelivr CDN 多源镜像访问（主仓库 `ApiUrl.pluginMarketIndexUrls()`）：

- `https://testingcf.jsdelivr.net/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://jsd.onmicrosoft.cn/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://cdn.jsdelivr.net/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://raw.githubusercontent.com/KingPrimes/nyxbot-plugins/main/plugin-index.json`（兜底）
