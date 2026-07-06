// NyxBot 插件市场公共工具库
// 无第三方依赖，仅用 Node.js 内置模块

import { createHash } from 'node:crypto';
import { get } from 'node:https';

export function die(msg) {
  process.stderr.write(`::error::${msg}\n`);
  process.exit(1);
}

export function httpsGet(url, { headers } = {}) {
  return new Promise((resolve, reject) => {
    get(url, { headers }, (res) => {
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

export async function httpsGetBuffer(url, { headers } = {}) {
  const res = await httpsGet(url, { headers });
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function httpsGetJson(url, { headers } = {}) {
  const buf = await httpsGetBuffer(url, { headers });
  return JSON.parse(buf.toString('utf8'));
}

// GitHub API 专用 GET（带 User-Agent + Accept + 可选 Token）
export async function ghApiGet(path, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nyxbot-plugins-workflow',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return httpsGetJson(`https://api.github.com${path}`, { headers });
}

// 解析 GitHub issue 表单正文为 {label: value} 字典
export function parseIssueBody(body) {
  const fields = {};
  const sections = body.split(/^###\s+/m);
  for (const section of sections) {
    if (!section.trim()) continue;
    const nl = section.indexOf('\n');
    if (nl === -1) continue;
    const label = section.slice(0, nl).trim();
    const value = section.slice(nl + 1).trim();
    if (value && value !== '_No response_') {
      fields[label] = value;
    }
  }
  return fields;
}

// 按关键字模糊匹配 issue 字段
export function pick(fields, ...possibleLabels) {
  for (const k of Object.keys(fields)) {
    if (possibleLabels.some(p => k.includes(p))) return fields[k];
  }
  return undefined;
}

// 从 Release tag_name 解析语义版本号（去掉前导 v/V）
export function parseVersion(tagName) {
  return tagName.replace(/^[vV]/, '');
}

// 获取仓库最新 Release
export async function fetchLatestRelease(repository, token) {
  try {
    return await ghApiGet(`/repos/${repository}/releases/latest`, token);
  } catch (e) {
    if (e.message.includes('404')) {
      die(`仓库 ${repository} 没有任何 Release，请先在 GitHub 发布 Release（含 .jar 资产）`);
    }
    die(`获取 ${repository} 最新 Release 失败: ${e.message}`);
  }
}

// 从 Release assets 中找到 .jar 资产
export function findJarAsset(assets, jarAssetName) {
  const jars = assets.filter(a => a.name.endsWith('.jar'));
  if (jars.length === 0) {
    die(`Release 没有 .jar 资产。可用资产: ${assets.map(a => a.name).join(', ') || '无'}`);
  }
  if (jarAssetName && jarAssetName !== '-') {
    const match = jars.find(a => a.name === jarAssetName);
    if (!match) die(`Release 中未找到名为 "${jarAssetName}" 的 .jar 资产。可用 .jar: ${jars.map(a => a.name).join(', ')}`);
    return match;
  }
  if (jars.length > 1) {
    die(`Release 有多个 .jar 资产: ${jars.map(a => a.name).join(', ')}。请在 issue 中填写「jar 资产名」字段指定`);
  }
  return jars[0];
}

// 下载文件并计算 sha256 + fileSize
export async function downloadAndHash(url) {
  const buf = await httpsGetBuffer(url);
  return {
    sha256: createHash('sha256').update(buf).digest('hex'),
    fileSize: buf.length,
  };
}

// 校验 repository 格式
export function validateRepoFormat(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    die(`repository "${repository}" 格式非法，应为 owner/repo`);
  }
}

// 校验 repository 公开可访问
export async function validateRepoPublic(repository, token) {
  try {
    const repoMeta = await ghApiGet(`/repos/${repository}`, token);
    if (repoMeta.archived) die(`仓库 ${repository} 已归档`);
    if (repoMeta.visibility && repoMeta.visibility !== 'public') {
      die(`仓库 ${repository} 不是公开仓库`);
    }
    return repoMeta;
  } catch (e) {
    die(`无法访问仓库 ${repository}: ${e.message}`);
  }
}
