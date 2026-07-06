// NyxBot 插件市场 — 新增插件校验脚本
// 从 issue 表单读取插件元数据，从作者仓库最新 Release 自动获取版本号 + jar
//
// 输入（环境变量）：
//   ISSUE_BODY      - issue 正文
//   ISSUE_NUMBER    - issue 编号
//   GITHUB_TOKEN    - GitHub Token
//
// 退出码：0=成功，1=校验失败

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  die, parseIssueBody, pick,
  validateRepoFormat, validateRepoPublic,
  fetchLatestRelease, parseVersion, findJarAsset, downloadAndHash,
} from './lib.mjs';

const INDEX_PATH = 'plugin-index.json';

const ISSUE_BODY = process.env.ISSUE_BODY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GITHUB_TOKEN;

if (!ISSUE_BODY) die('ISSUE_BODY 环境变量未设置');
if (!ISSUE_NUMBER) die('ISSUE_NUMBER 环境变量未设置');

const fields = parseIssueBody(ISSUE_BODY);

const submission = {
  name:          pick(fields, '插件唯一标识名'),
  displayName:   pick(fields, '展示名称'),
  description:   pick(fields, '插件描述'),
  author:        pick(fields, '作者'),
  type:          pick(fields, '插件类型'),
  repository:    pick(fields, '源代码仓库'),
  license:       pick(fields, '许可证'),
  homepage:      pick(fields, '项目主页'),
  iconUrl:       pick(fields, '图标'),
  tags:          pick(fields, '标签'),
  jarAssetName:  pick(fields, 'jar 资产名'),
  requires:      pick(fields, 'Java 版本'),
};

const required = ['name','displayName','description','author','type','repository','license','requires'];
const missing = required.filter(k => !submission[k]);
if (missing.length) die(`缺少必填字段: ${missing.join(', ')}`);

if (!/^[a-z0-9-]+$/.test(submission.name)) {
  die(`插件标识名 "${submission.name}" 格式非法，只允许小写字母、数字、短横线`);
}

if (!['jar', 'native'].includes(submission.type)) {
  die(`插件类型必须为 jar 或 native，实际: ${submission.type}`);
}

validateRepoFormat(submission.repository);
console.log(`[1/6] 解析 issue 字段完成: ${submission.name}`);

await validateRepoPublic(submission.repository, GH_TOKEN);
console.log(`[2/6] 仓库 ${submission.repository} 公开可访问`);

// 从最新 Release 自动获取版本号 + jar 下载地址
const release = await fetchLatestRelease(submission.repository, GH_TOKEN);
const version = parseVersion(release.tag_name);
const jarAsset = findJarAsset(release.assets, submission.jarAssetName);
const downloadUrl = jarAsset.browser_download_url;
const releaseNotes = (release.body || '').slice(0, 500);
console.log(`[3/6] Release ${release.tag_name} -> 版本 ${version}, jar=${jarAsset.name}`);

const { sha256, fileSize } = await downloadAndHash(downloadUrl);
console.log(`[4/6] 下载校验完成: ${fileSize} bytes, sha256=${sha256.slice(0, 12)}...`);

let index;
if (existsSync(INDEX_PATH)) {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
} else {
  index = { schemaVersion: '1.0', marketplace: 'nyxbot-plugins', updatedAt: new Date().toISOString(), plugins: {} };
}

if (index.plugins[submission.name]) {
  die(`插件 "${submission.name}" 已存在。如需更新版本请使用「插件更新」issue 模板`);
}
console.log(`[5/6] 插件名唯一性校验通过`);

const tags = submission.tags ? submission.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

index.plugins[submission.name] = {
  name: submission.name,
  displayName: submission.displayName,
  description: submission.description,
  author: submission.author,
  type: submission.type,
  repository: submission.repository,
  license: submission.license,
  homepage: submission.homepage && submission.homepage !== '-' ? submission.homepage : null,
  iconUrl: submission.iconUrl && submission.iconUrl !== '-' ? submission.iconUrl : null,
  tags,
  versions: {
    [version]: { downloadUrl, fileSize, sha256, requires: submission.requires, releaseNotes },
  },
};

index.updatedAt = new Date().toISOString();
writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`[6/6] plugin-index.json 已更新`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  writeFileSync(summary, [
    `## 插件校验报告`,
    ``,
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 插件标识 | \`${submission.name}\` |`,
    `| 展示名 | ${submission.displayName} |`,
    `| 版本 | \`${version}\`（来自 Release \`${release.tag_name}\`） |`,
    `| 作者 | [@${submission.author}](https://github.com/${submission.author}) |`,
    `| 类型 | \`${submission.type}\` |`,
    `| 仓库 | [${submission.repository}](https://github.com/${submission.repository}) |`,
    `| 许可证 | ${submission.license} |`,
    `| 标签 | ${tags.length ? tags.map(t => `\`${t}\``).join(' ') : '—'} |`,
    `| Java 要求 | \`${submission.requires}\` |`,
    `| jar 资产 | \`${jarAsset.name}\` |`,
    `| 文件大小 | ${fileSize} bytes |`,
    `| SHA-256 | \`${sha256}\` |`,
    `| 来源 issue | #${ISSUE_NUMBER} |`,
    ``,
    `### 校验项`,
    `- [x] 必填字段完整`,
    `- [x] 插件名格式合法`,
    `- [x] repository 公开可访问`,
    `- [x] Release 存在且含 .jar 资产`,
    `- [x] 版本号自动获取: \`${release.tag_name}\` -> \`${version}\``,
    `- [x] SHA-256 / fileSize 已计算`,
    `- [x] 插件名唯一（不与现有索引重名）`,
  ].join('\n'), 'utf8');
}

const branch = `plugin/${submission.name}-${version}`;
console.log(`::set-output name=branch::${branch}`);
console.log(`::set-output name=plugin_name::${submission.name}`);
console.log(`::set-output name=plugin_version::${version}`);
