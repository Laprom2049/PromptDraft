const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

test('Unicode project round trip preserves authorship and every field', () => {
  const project = Core.defaultProject();
  project.title = '中文“标题” 🧩';
  project.blocks[0].text = '第一行\n第二行 \\ 中文 {{项目}}';
  project.variables['项目'] = '路径 C:\\用户\\测试\nemoji 🧑‍💻';
  project.authorNote = '仅作者可见 {{不能发送}}';
  project.includeSnippet = false;
  const restored = Core.validateProject(JSON.parse(Core.serialize(project)));
  assert.equal(Core.serialize(restored), Core.serialize(project));
  const compiled = Core.compile(restored);
  assert.ok(compiled.text.includes('🧑‍💻'));
  assert.ok(!compiled.text.includes('仅作者可见'));
  assert.ok(!compiled.variables.includes('不能发送'));
  assert.ok(!compiled.text.includes('返回修改摘要'));
});

test('Values are inserted exactly once, including special replacement syntax', () => {
  const project = Core.importText('{{a}} / {{a}} / {{ __proto__ }}', '测试.md');
  project.variables.a = '$& $1 {{b}} <script>not executable</script>';
  project.variables['__proto__'] = 'ordinary value';
  const result = Core.compile(project);
  assert.deepEqual(result.variables, ['a', '__proto__']);
  assert.deepEqual(result.missing, []);
  assert.ok(result.text.includes('$& $1 {{b}} <script>not executable</script>'));
  assert.ok(result.text.includes('ordinary value'));
  assert.ok(!result.variables.includes('b'));
});

test('Missing, empty and unclosed variables remain visible and generate diagnostics', () => {
  const project = Core.importText('{{missing}} {{ }} {{unclosed', '变量');
  const result = Core.compile(project);
  assert.deepEqual(result.missing, ['missing']);
  assert.equal(result.errors.length, 2);
  assert.ok(result.text.includes('{{missing}}'));
  assert.ok(result.text.includes('{{ }}'));
});

test('Escaped template opener is a literal and does not create an input', () => {
  const project = Core.importText('示例 \\{{literal}}；输入 {{real}}', '转义.txt');
  project.variables.real = '真实';
  const result = Core.compile(project);
  assert.deepEqual(result.variables, ['real']);
  assert.ok(result.text.includes('示例 {{literal}}；输入 真实'));
});

test('Invalid import is rejected rather than silently normalized into a different project', () => {
  const project = Core.defaultProject();
  assert.throws(() => Core.validateProject({ ...project, schemaVersion: 999 }), /版本/);
  assert.throws(() => Core.validateProject({ ...project, variables: { input: 123 } }), /文本/);
  assert.throws(() => Core.validateProject({ ...project, blocks: [project.blocks[0], project.blocks[0]] }), /重复/);
  assert.throws(() => Core.validateProject({ ...project, snippetVersion: 'report-v2' }), /片段版本/);
  assert.throws(() => Core.validateProject({ ...project, blocks: [] }), /段落/);
});

test('Template metadata maps to actual serialized headings while plain body stays plain', () => {
  const project = Core.defaultProject();
  project.blocks[1].type = '背景';
  assert.ok(Core.compile(project).text.includes('## 背景\n保持公开 API 不变。'));
  const text = Core.importText('原文\n# 保留原来的 Markdown', '文稿.md');
  const result = Core.compile(text);
  assert.ok(result.text.includes('原文\n# 保留原来的 Markdown'));
  assert.ok(!result.text.includes('## 正文'));
});

test('Empty body and whitespace-only variable values do not pass checks', () => {
  const project = Core.importText('  \n', '空白');
  assert.equal(Core.compile(project).bodyPresent, false);
  project.blocks[0].text = '{{x}}';
  project.variables.x = '\n  ';
  assert.deepEqual(Core.compile(project).missing, ['x']);
});

test('Windows filenames avoid reserved names and invalid path characters', () => {
  assert.equal(Core.safeFilename('CON'), '提示词文稿');
  assert.equal(Core.safeFilename('a/b:c*'), 'a-b-c-');
  assert.equal(Core.safeFilename('文稿 🧩'), '文稿 🧩');
});
