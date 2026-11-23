(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromptDraftCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = '0.1.0';
  const TYPES = ['目标', '背景', '约束', '步骤建议', '示例', '验收', '正文'];
  const SNIPPET_VERSION = 'report-v1';
  const SNIPPET_TEXT = '返回修改摘要、验证结果、优化前后对比，以及未解决的问题。';
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function id() {
    if (typeof globalThis.crypto === 'object' && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function defaultProject() {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      title: '性能优化任务',
      blocks: [
        { id: id(), type: '目标', text: '分析 {{project}} 的性能瓶颈，提出并实现必要的优化。' },
        { id: id(), type: '约束', text: '保持公开 API 不变。' },
        { id: id(), type: '步骤建议', text: '每次修改后运行测试；失败时分析原因并修复，最多重试 3 次。仍未通过时停止并报告。' },
        { id: id(), type: '验收', text: '全部测试通过。在相同环境与输入下报告优化前后的基准结果，并解释性能变化。' }
      ],
      variables: Object.assign(Object.create(null), { project: '示例项目' }),
      authorNote: '先用小型项目试验这段任务，确认检查方式后再扩大范围。',
      includeSnippet: true,
      snippetVersion: SNIPPET_VERSION,
      createdAt: now,
      updatedAt: now
    };
  }

  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + '格式错误。');
    return value;
  }

  function boundedString(value, label, max, fallback) {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'string') throw new Error(label + '必须是文本。');
    if (value.length > max) throw new Error(label + '过长。');
    if (value.includes('\u0000')) throw new Error(label + '包含不支持的空字符。');
    return value;
  }

  function validateProject(raw) {
    record(raw, '项目');
    if (raw.schemaVersion !== 1) throw new Error('不支持的项目版本。请打开本工具导出的 .prompt.json 文件。');
    if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 500) throw new Error('项目应包含 1 至 500 个段落。');
    const ids = new Set();
    const blocks = raw.blocks.map((block, index) => {
      record(block, '段落 ' + (index + 1));
      const type = boundedString(block.type, '段落用途', 20);
      if (!TYPES.includes(type)) throw new Error('未知的段落用途：' + type);
      const blockID = boundedString(block.id, '段落 ID', 120);
      if (!blockID || ids.has(blockID) || !/^[a-zA-Z0-9_-]+$/.test(blockID)) throw new Error('段落 ID 无效或重复。');
      ids.add(blockID);
      return { id: blockID, type, text: boundedString(block.text, '段落正文', 2000000) };
    });
    const rawVariables = record(raw.variables === undefined ? {} : raw.variables, '变量');
    const names = Object.keys(rawVariables);
    if (names.length > 1000) throw new Error('变量数量超过限制。');
    const variables = Object.create(null);
    for (const name of names) {
      if (!name.trim() || name.length > 100 || /[{}\r\n\u0000]/.test(name)) throw new Error('变量名称无效。');
      variables[name] = boundedString(rawVariables[name], '变量值', 2000000);
    }
    if (typeof raw.includeSnippet !== 'boolean') throw new Error('引用片段的状态无效。');
    if (raw.snippetVersion !== SNIPPET_VERSION) throw new Error('不支持的引用片段版本。');
    const now = new Date().toISOString();
    const result = {
      schemaVersion: 1,
      title: boundedString(raw.title, '文稿标题', 500),
      blocks,
      variables,
      authorNote: boundedString(raw.authorNote, '作者备注', 2000000, ''),
      includeSnippet: raw.includeSnippet,
      snippetVersion: SNIPPET_VERSION,
      createdAt: boundedString(raw.createdAt, '创建时间', 64, now),
      updatedAt: boundedString(raw.updatedAt, '修改时间', 64, now)
    };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_FILE_BYTES) throw new Error('项目内容超过 5 MB 限制。');
    return result;
  }

  function sourceText(project) {
    const parts = [];
    if (project.title.trim()) parts.push('# ' + project.title.trim());
    for (const block of project.blocks) {
      if (!block.text.trim()) continue;
      parts.push((block.type === '正文' ? '' : '## ' + block.type + '\n') + block.text);
    }
    if (project.includeSnippet) parts.push('## 结果报告\n' + SNIPPET_TEXT);
    return parts.join('\n\n');
  }

  function parseTemplate(source) {
    const segments = [];
    const errors = [];
    let buffer = '';
    const flush = () => { if (buffer) { segments.push({ kind: 'text', text: buffer }); buffer = ''; } };
    for (let i = 0; i < source.length;) {
      if (source.startsWith('\\{{', i)) {
        buffer += '{{';
        i += 3;
        continue;
      }
      if (!source.startsWith('{{', i)) { buffer += source[i++]; continue; }
      const end = source.indexOf('}}', i + 2);
      if (end < 0) {
        errors.push({ message: '有变量占位符缺少结尾的 }}。字面量可写成 \\{{。' });
        buffer += source.slice(i);
        break;
      }
      const raw = source.slice(i, end + 2);
      const name = source.slice(i + 2, end).trim();
      if (!name || name.length > 100 || /[{}\r\n]/.test(name)) {
        errors.push({ message: !name ? '变量名不能为空。' : '变量名称应为不含花括号和换行的短文本。' });
        buffer += raw;
      } else {
        flush();
        segments.push({ kind: 'variable', name, raw });
      }
      i = end + 2;
    }
    flush();
    return { segments, errors };
  }

  function compile(project) {
    const parsed = parseTemplate(sourceText(project));
    const variables = [];
    const missing = [];
    const seen = new Set();
    const output = [];
    for (const segment of parsed.segments) {
      if (segment.kind === 'text') { output.push(segment.text); continue; }
      const name = segment.name;
      const value = owns(project.variables, name) ? project.variables[name] : '';
      const filled = typeof value === 'string' && value.trim().length > 0;
      if (!seen.has(name)) {
        variables.push(name);
        if (!filled) missing.push(name);
        seen.add(name);
      }
      output.push(filled ? value : segment.raw);
    }
    const text = output.join('');
    return {
      text,
      variables,
      missing,
      errors: parsed.errors,
      bodyPresent: project.blocks.some(block => block.text.trim().length > 0),
      chars: Array.from(text).length
    };
  }

  function serialize(project) {
    return JSON.stringify(validateProject(project), null, 2);
  }

  function clone(project) {
    return validateProject(JSON.parse(serialize(project)));
  }

  function importText(text, filename) {
    boundedString(text, '导入内容', MAX_FILE_BYTES);
    const now = new Date().toISOString();
    return validateProject({
      schemaVersion: 1,
      title: String(filename || '导入文稿').replace(/\.(txt|md|markdown)$/i, '').slice(0, 500),
      blocks: [{ id: id(), type: '正文', text: text.replace(/^\uFEFF/, '') }],
      variables: Object.create(null),
      authorNote: '',
      includeSnippet: false,
      snippetVersion: SNIPPET_VERSION,
      createdAt: now,
      updatedAt: now
    });
  }

  function safeFilename(title) {
    const base = String(title || '提示词文稿').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 100);
    if (!base || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)) return '提示词文稿';
    return base;
  }

  return { VERSION, TYPES, SNIPPET_VERSION, SNIPPET_TEXT, MAX_FILE_BYTES, id, defaultProject, validateProject, compile, serialize, clone, importText, safeFilename, parseTemplate };
});
