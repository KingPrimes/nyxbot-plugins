// NyxBot 插件市场索引校验+更新脚本
// 无第三方依赖，仅用 Node.js 内置模块（fs/crypto/https）
//
// 输入（环境变量）：
//   ISSUE_BODY      - issue 正文（GitHub 表单产生的 Markdown）
//   ISSUE_NUMBER    - issue 编号
//   GITHUB_TOKEN    - GitHub Token（用于校验仓库公开性）
//
// 行为：
//   1. 解析 issue 表单字段
//   2. 校验 repository 公开可访问
//   3. 下载 downloadUrl，计算 sha256 + fileSize
//   4. 校验插件名唯一性（不允许重名）
//   5. 更新 plugin-index.json（新增插件条目）
//   6. 输出校验报告到 $GITHUB_STEP_SUMMARY，供 PR 描述引用
//
// 退出码：
//   0 = 成功
//   1 = 校验失败（原因会写入 stderr 和 step summary）

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { get } from 'node:https';
import { execSync } from 'node:child_process';

const INDEX_PATH = 'plugin-index.json';
const RAW_BASE = 'https://raw.githubusercontent.com';

// ─── 工具函数 ───

function die(msg) {
  process.stderr.write(`::error::${msg}\n`);
  process.exit(1);
}

function httpsGet(url, { headers } = {}) {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (res) => {
      // 跟随重定向（GitHub Release 会跳到 objects.githubusercontent.com）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, { headers }).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function httpsGetBuffer(url, { headers } = {}) {
  const res = await httpsGet(url, { headers });
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks);
}

async function httpsGetJson(url, { headers } = {}) {
  const buf = await httpsGetBuffer(url, { headers });
  return JSON.parse(buf.toString('utf8'));
}

// 解析 GitHub issue 表单正文为 {fieldId: value} 字典
// 表单正文格式（GitHub 自动生成）：
//   ### 标签文本
//   value
//   ### 下一个标签
//   ...
function parseIssueBody(body) {
  const fields = {};
  const sections = body.split(/^###\s+/m);
  for (const section of sections) {
    if (!section.trim()) continue;
    const nl = section.indexOf('\n');
    if (nl === -1) continue;
    const label = section.slice(0, nl).trim();
    const value = section.slice(nl + 1).trim();
    // 去掉 _No response_ 占位
    if (value && value !== '_No response_') {
      fields[label] = value;
    }
  }
  return fields;
}

// ─── 主流程 ───

const ISSUE_BODY = process.env.ISSUE_BODY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const GH_TOKEN = process.env.GITHUB_TOKEN;

if (!ISSUE_BODY) die('ISSUE_BODY 环境变量未设置');
if (!ISSUE_NUMBER) die('ISSUE_NUMBER 环境变量未设置');

const fields = parseIssueBody(ISSUE_BODY);

// issue 表单 label → 字段映射（注意 yml 中 label 文本带中文，这里按显示文本匹配）
// 用函数式取值，避免硬编码 label 文本
function pick(...possibleLabels) {
  for (const k of Object.keys(fields)) {
    if (possibleLabels.some(p => k.includes(p))) return fields[k];
  }
  return undefined;
}

const submission = {
  name:          pick('插件唯一标识名'),
  displayName:   pick('展示名称'),
  description:   pick('插件描述'),
  author:        pick('作者'),
  type:          pick('插件类型'),
  repository:    pick('源代码仓库'),
  license:       pick('许可证'),
  homepage:      pick('项目主页'),
  iconUrl:       pick('图标'),
  tags:          pick('标签'),
  version:       pick('版本号'),
  downloadUrl:   pick('下载地址'),
  requires:      pick('Java 版本'),
  releaseNotes:  pick('发布说明'),
};

// 必填校验
const required = ['name','displayName','description','author','type','repository','license','version','downloadUrl','requires'];
const missing = required.filter(k => !submission[k]);
if (missing.length) die(`缺少必填字段: ${missing.join(', ')}`);

// name 格式校验：全小写英文+数字+短横线
if (!/^[a-z0-9-]+$/.test(submission.name)) {
  die(`插件标识名 "${submission.name}" 格式非法，只允许小写字母、数字、短横线`);
}

// type 校验
if (!['jar', 'native'].includes(submission.type)) {
  die(`插件类型必须为 jar 或 native，实际: ${submission.type}`);
}

// downloadUrl 格式校验
if (!submission.downloadUrl.startsWith('https://github.com/') || !submission.downloadUrl.endsWith('.jar')) {
  die(`downloadUrl 必须是 GitHub Release 直链且以 .jar 结尾`);
}

// repository 格式校验
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(submission.repository)) {
  die(`repository "${submission.repository}" 格式非法，应为 owner/repo`);
}

console.log(`[1/5] 解析 issue 字段完成: ${submission.name} v${submission.version}`);

// ─── 校验 1: repository 公开可访问 ───
const authHeaders = GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {};
try {
  const repoMeta = await httpsGetJson(`https://api.github.com/repos/${submission.repository}`, { headers: authHeaders });
  if (repoMeta.archived) die(`仓库 ${submission.repository} 已归档`);
  if (!repoMeta.permissions?.push && repoMeta.visibility !== 'public') {
    // 公开仓库放行
    if (repoMeta.visibility && repoMeta.visibility !== 'public') die(`仓库 ${submission.repository} 不是公开仓库`);
  }
  console.log(`[2/5] 仓库 ${submission.repository} 公开可访问`);
} catch (e) {
  die(`无法访问仓库 ${submission.repository}: ${e.message}`);
}

// ─── 校验 2: downloadUrl 可达 + 计算 sha256/fileSize ───
let fileBuf;
try {
  fileBuf = await httpsGetBuffer(submission.downloadUrl);
} catch (e) {
  die(`下载 jar 失败: ${e.message}`);
}
const sha256 = createHash('sha256').update(fileBuf).digest('hex');
const fileSize = fileBuf.length;
console.log(`[3/5] 下载校验完成: ${fileSize} bytes, sha256=${sha256.slice(0, 12)}...`);

// ─── 读取现有索引 + 校验插件名唯一性 ───
let index;
if (existsSync(INDEX_PATH)) {
  index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
} else {
  index = {
    schemaVersion: '1.0',
    marketplace: 'nyxbot-plugins',
    updatedAt: new Date().toISOString(),
    plugins: {},
  };
}

if (index.plugins[submission.name]) {
  die(`插件 "${submission.name}" 已存在。当前只支持新增插件，不支持更新已有插件的新版本。`);
}
console.log(`[4/5] 插件名唯一性校验通过`);

// ─── 构造新插件条目 + 更新索引 ───
const tags = submission.tags
  ? submission.tags.split(',').map(t => t.trim()).filter(Boolean)
  : [];

const entry = {
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
    [submission.version]: {
      downloadUrl: submission.downloadUrl,
      fileSize,
      sha256,
      requires: submission.requires,
      releaseNotes: submission.releaseNotes || '',
    },
  },
};

index.plugins[submission.name] = entry;
index.updatedAt = new Date().toISOString();

writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`[5/5] plugin-index.json 已更新`);

// ─── 输出校验报告到 step summary ───
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const report = [
    `## 插件校验报告`,
    ``,
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 插件标识 | \`${submission.name}\` |`,
    `| 展示名 | ${submission.displayName} |`,
    `| 版本 | \`${submission.version}\` |`,
    `| 作者 | [@${submission.author}](https://github.com/${submission.author}) |`,
    `| 类型 | \`${submission.type}\` |`,
    `| 仓库 | [${submission.repository}](https://github.com/${submission.repository}) |`,
    `| 许可证 | ${submission.license} |`,
    `| 标签 | ${tags.length ? tags.map(t => `\`${t}\``).join(' ') : '—'} |`,
    `| Java 要求 | \`${submission.requires}\` |`,
    `| 文件大小 | ${fileSize} bytes |`,
    `| SHA-256 | \`${sha256}\` |`,
    `| 来源 issue | #${ISSUE_NUMBER} |`,
    ``,
    `### 校验项`,
    `- [x] 必填字段完整`,
    `- [x] 插件名格式合法`,
    `- [x] repository 公开可访问`,
    `- [x] downloadUrl 可下载`,
    `- [x] SHA-256 / fileSize 已计算`,
    `- [x] 插件名唯一（不与现有索引重名）`,
  ].join('\n');
  writeFileSync(summary, report, 'utf8');
}

// 输出 PR 分支名供工作流使用
const branch = `plugin/${submission.name}-${submission.version}`;
console.log(`::set-output name=branch::${branch}`);
console.log(`::set-output name=plugin_name::${submission.name}`);
console.log(`::set-output name=plugin_version::${submission.version}`);
