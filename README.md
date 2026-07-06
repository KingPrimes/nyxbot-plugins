# NyxBot Plugins

NyxBot 插件市场索引仓库。本仓库只存储 `plugin-index.json` 索引文件，不托管插件 jar 二进制——jar 由插件作者在自己的 GitHub Release 发布。

## 提交插件

1. 点击 [Issues](../../issues/new/choose) → 选择「插件提交」模板
2. 填写插件信息（名称、作者、仓库、下载地址等）
3. 提交 issue 后，GitHub Actions 会自动执行校验：
   - 验证 `repository` 公开可访问
   - 下载 `downloadUrl` 指向的 jar，计算 SHA-256 与文件大小
   - 校验插件名唯一性（不与已有插件重名）
4. 校验通过 → 自动创建 PR（含校验报告），等待仓库 owner 审核合并
5. 校验失败 → 自动在 issue 评论失败原因并打上 `invalid` 标签

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
          "downloadUrl": "GitHub Release 直链",
          "fileSize": 12345,
          "sha256": "hex校验和",
          "requires": ">=21",
          "releaseNotes": "发布说明"
        }
      }
    }
  }
}
```

## CDN 访问

`plugin-index.json` 通过 jsDelivr CDN 多源镜像访问（主仓库 `ApiUrl.pluginMarketIndexUrls()`）：

- `https://testingcf.jsdelivr.net/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://jsd.onmicrosoft.cn/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://cdn.jsdelivr.net/gh/KingPrimes/nyxbot-plugins@main/plugin-index.json`
- `https://raw.githubusercontent.com/KingPrimes/nyxbot-plugins/main/plugin-index.json`（兜底）
