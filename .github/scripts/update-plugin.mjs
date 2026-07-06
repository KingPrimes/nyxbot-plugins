// NyxBot 插件市场 — 更新插件脚本
// 从 issue 读取插件名，从作者仓库最新 Release 自动拉取新版本
//
// 输入（环境变量）：
//   ISSUE_BODY      - issue 正文
//   ISSUE_NUMBER    - issue 编号
//   GITHUB_TOKEN    - GitHub Token
//
// 退出码：0=成功，1=校验失败

import { readFileSync, writeFileSync } from 'node:fs';
import {
  die, parseIssueBody, pick,
  fetchLatestRelease, parseVersion, findJarAsset, downloadAndHash,
} from './lib.mjs';

const INDEX_PATH = 'plugin-index.json';

const ISSUE_BODY = process.env.ISSUE_BODY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GITHUB_TOKEN;

if (!ISSUE_BODY) die('ISSUE_BODY 环境变量未设置');
if (!ISSUE_NUMBER) die('ISSUE_NUMBER 环境变量未设置');

const fields = parseIssueBody(ISSUE_BODY);

const pluginName = pick(fields, '插件标识名', '要更新的插件');
const jarAssetName = pick(fields, 'jar 资产名');

if (!pluginName) die('缺少必填字段: 插件标识名');

console.log(`[1/5] 解析 issue: 更新插件 ${pluginName}`);

let index;
try {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
} catch {
  die('plugin-index.json 不存在或解析失败');
}

// 校验插件已存在
const entry = index.plugins[pluginName];
if (!entry) {
  die(`插件 "${pluginName}" 不存在于索引中。如需新增请使用「插件提交」issue 模板`);
}
console.log(`[2/5] 插件 ${pluginName} 已存在，当前版本: ${Object.keys(entry.versions).join(', ')}`);

// 从索引读 repository（防冒充：不允许 issue 覆盖 repository）
const repository = entry.repository;
console.log(`[3/5] 从索引读取仓库: ${repository}`);

// 查最新 Release
const release = await fetchLatestRelease(repository, GH_TOKEN);
const version = parseVersion(release.tag_name);
const jarAsset = findJarAsset(release.assets, jarAssetName);
const downloadUrl = jarAsset.browser_download_url;
const releaseNotes = (release.body || '').slice(0, 500);

// 校验版本号不重复
if (entry.versions[version]) {
  die(`版本 "${version}" 已存在于索引中（Release tag ${release.tag_name}）。当前已有版本: ${Object.keys(entry.versions).join(', ')}`);
}
console.log(`[4/5] 新版本 ${version} 不重复，开始下载校验`);

const { sha256, fileSize } = await downloadAndHash(downloadUrl);

// 继承已有版本的 requires（更新 issue 不让用户填 requires）
const existingVersions = Object.values(entry.versions);
const requires = existingVersions[0]?.requires || '>=21';

entry.versions[version] = { downloadUrl, fileSize, sha256, requires, releaseNotes };

index.updatedAt = new Date().toISOString();
writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`[5/5] plugin-index.json 已更新，新增版本 ${version}`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const prevVersions = Object.keys(entry.versions).filter(v => v !== version);
  writeFileSync(summary, [
    `## 插件更新报告`,
    ``,
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 插件标识 | \`${pluginName}\` |`,
    `| 展示名 | ${entry.displayName} |`,
    `| 新版本 | \`${version}\`（来自 Release \`${release.tag_name}\`） |`,
    `| 仓库 | [${repository}](https://github.com/${repository}) |`,
    `| jar 资产 | \`${jarAsset.name}\` |`,
    `| 文件大小 | ${fileSize} bytes |`,
    `| SHA-256 | \`${sha256}\` |`,
    `| 已有版本 | ${prevVersions.map(v => `\`${v}\``).join(', ')} |`,
    `| 来源 issue | #${ISSUE_NUMBER} |`,
    ``,
    `### 校验项`,
    `- [x] 插件已存在于索引`,
    `- [x] repository 从索引读取（防冒充）`,
    `- [x] Release 存在且含 .jar 资产`,
    `- [x] 版本号不重复`,
    `- [x] SHA-256 / fileSize 已计算`,
  ].join('\n'), 'utf8');
}

const branch = `plugin-update/${pluginName}-${version}`;
console.log(`::set-output name=branch::${branch}`);
console.log(`::set-output name=plugin_name::${pluginName}`);
console.log(`::set-output name=plugin_version::${version}`);
