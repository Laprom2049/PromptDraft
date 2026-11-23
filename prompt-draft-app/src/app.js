(function () {
  'use strict';
  const C = window.PromptDraftCore;
  const el = (id) => document.getElementById(id);
  const KEY = 'prompt-draft.project.v1';
  const BACKUP = 'prompt-draft.project.backup.v1';
  const HISTORY = 'prompt-draft.history.v1';
  const session = C.id();
  let project = C.defaultProject();
  let selected = project.blocks[1] ? project.blocks[1].id : project.blocks[0].id;
  let view = 'edit';
  let compiled = C.compile(project);
  let variableSignature = null;
  let dirty = false;
  let paused = false;
  let lastSavedRaw = null;
  let lastSavedProject = '';
  let saveTimer = null;
  let toastTimer = null;
  let composing = false;
  let history = [];

  function notify(text) {
    el('toast').textContent = text;
    el('toast').hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { el('toast').hidden = true; }, 6500);
  }

  function warning(text) {
    el('storage-warning').textContent = text;
    el('storage-warning').hidden = !text;
  }

  function saveStatus(text, error) {
    el('save-status').textContent = text;
    el('save-status').classList.toggle('error', Boolean(error));
  }

  function pauseForConflict(message) {
    paused = true;
    window.clearTimeout(saveTimer);
    el('conflict-message').textContent = message || '另一窗口更新了文稿。本窗口已暂停自动保存，请先保存项目文件，再选择要继续使用的内容。';
    el('storage-conflict').hidden = false;
    saveStatus('自动恢复更新已暂停', true);
  }

  function unpack(raw) {
    const value = JSON.parse(raw);
    return C.validateProject(value && value.project ? value.project : value);
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      lastSavedRaw = raw;
      if (raw) {
        try {
          project = unpack(raw);
          lastSavedProject = C.serialize(project);
          saveStatus('已恢复本机文稿');
        } catch (error) {
          const backup = localStorage.getItem(BACKUP);
          if (backup) {
            try {
              project = unpack(backup);
              pauseForConflict('当前自动恢复副本无法读取，已打开上一份备份。请先保存项目文件；确认后可保留本窗口并继续。');
            } catch (backupError) {
              pauseForConflict('自动恢复副本及备份无法读取。原数据尚未覆盖；请打开已有项目文件，或保留当前新文稿并继续。');
            }
          } else {
            pauseForConflict('自动恢复副本无法读取。原数据尚未覆盖；请打开已有项目文件，或保留当前新文稿并继续。');
          }
        }
      } else {
        saveStatus('新文稿 · 尚未更新自动恢复副本');
      }
    } catch (error) {
      saveStatus('自动恢复不可用', true);
      warning('自动恢复不可用，请用“保存项目”导出备份。你仍可编辑、导入和导出文稿。');
    }
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY) || '[]');
      if (Array.isArray(stored)) {
        history = stored.slice(0, 20).map((item) => ({
          id: typeof item.id === 'string' ? item.id : C.id(),
          time: typeof item.time === 'string' ? item.time : new Date().toISOString(),
          reason: typeof item.reason === 'string' ? item.reason.slice(0, 100) : '快照',
          project: C.validateProject(item.project)
        }));
      }
    } catch (error) {
      history = [];
      warning('部分本机历史记录无法读取。当前文稿不受影响；请保存项目文件作为备份。');
    }
  }

  function persistNow() {
    window.clearTimeout(saveTimer);
    if (paused) return false;
    try {
      const serialized = C.serialize(project);
      const actual = localStorage.getItem(KEY);
      if (actual !== lastSavedRaw) {
        pauseForConflict();
        return false;
      }
      if (serialized === lastSavedProject && actual) {
        dirty = false;
        return true;
      }
      const envelope = JSON.stringify({ writer: session, savedAt: new Date().toISOString(), project: JSON.parse(serialized) });
      if (lastSavedRaw) {
        try { unpack(lastSavedRaw); localStorage.setItem(BACKUP, lastSavedRaw); }
        catch (error) {
          if (error && error.name === 'QuotaExceededError') throw error;
        }
      }
      localStorage.setItem(KEY, envelope);
      lastSavedRaw = envelope;
      lastSavedProject = serialized;
      dirty = false;
      saveStatus('自动恢复副本已更新 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
      warning('');
      return true;
    } catch (error) {
      dirty = true;
      saveStatus('自动恢复不可用 · 请保存项目', true);
      warning('自动恢复更新失败。请点击“保存项目”下载备份；当前内容仍保留在这个窗口中。' + (error && error.message ? ' ' + error.message : ''));
      return false;
    }
  }

  function changed() {
    project.updatedAt = new Date().toISOString();
    dirty = true;
    updateDerived();
    if (paused) return;
    saveStatus('等待更新自动恢复副本…');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistNow, 500);
  }

  function resize(area) {
    if (area && area.offsetParent !== null) {
      area.style.height = 'auto';
      area.style.height = Math.max(32, area.scrollHeight) + 'px';
    }
  }

  function resizeAll() {
    document.querySelectorAll('textarea.writing').forEach(resize);
  }

  function selectBlock(id) {
    const block = project.blocks.find((item) => item.id === id);
    if (!block) return;
    selected = id;
    document.querySelectorAll('.document-block').forEach((node) => node.classList.toggle('is-current', node.dataset.block === id));
    el('block-type').value = block.type;
    el('included-state').textContent = block.text.trim() ? '是' : '空段落，不发送';
    const hints = {
      '约束': '标记为“约束”会整理正文，不会自动限制 Agent 的操作。',
      '验收': '验收文字会进入发送内容，独立的结果检查尚未绑定。',
      '步骤建议': '这里描述期望的步骤，重试次数尚未由执行器强制计数。'
    };
    el('type-hint').textContent = hints[block.type] || '段落用途帮助整理文稿，不改变消息权限。';
  }

  function button(text, action, label) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', action);
    return node;
  }

  function moveBlock(id, direction) {
    const index = project.blocks.findIndex((item) => item.id === id);
    const target = index + direction;
    if (target < 0 || target >= project.blocks.length) return;
    const current = el('block-' + id);
    const other = el('block-' + project.blocks[target].id);
    const swapped = project.blocks[index];
    project.blocks[index] = project.blocks[target];
    project.blocks[target] = swapped;
    if (direction < 0) current.parentNode.insertBefore(current, other);
    else current.parentNode.insertBefore(other, current);
    selectBlock(id);
    changed();
    refreshMoveButtons();
  }

  function refreshMoveButtons() {
    project.blocks.forEach((block, index) => {
      const node = el('block-' + block.id);
      node.querySelector('[data-direction="up"]').disabled = index === 0;
      node.querySelector('[data-direction="down"]').disabled = index === project.blocks.length - 1;
    });
  }

  function createBlock(block) {
    const wrap = document.createElement('div');
    wrap.className = 'document-block';
    wrap.dataset.block = block.id;
    wrap.id = 'block-' + block.id;
    const head = document.createElement('div');
    head.className = 'block-head';
    const label = document.createElement('label');
    label.className = 'block-label';
    label.htmlFor = 'text-' + block.id;
    label.textContent = block.type;
    const actions = document.createElement('div');
    actions.className = 'block-actions';
    const up = button('上移', () => moveBlock(block.id, -1), '上移这一段');
    up.dataset.direction = 'up';
    const down = button('下移', () => moveBlock(block.id, 1), '下移这一段');
    down.dataset.direction = 'down';
    const remove = button('删除', () => {
      if (block.text.trim() && !window.confirm('删除这一段正文？此操作不能通过文字撤销恢复。')) return;
      const index = project.blocks.findIndex((item) => item.id === block.id);
      project.blocks.splice(index, 1);
      wrap.remove();
      if (!project.blocks.length) {
        const empty = { id: C.id(), type: '正文', text: '' };
        project.blocks.push(empty);
        createBlock(empty);
      }
      if (selected === block.id) selectBlock(project.blocks[Math.min(index, project.blocks.length - 1)].id);
      refreshMoveButtons();
      changed();
    }, '删除这一段');
    actions.append(up, down, remove);
    head.append(label, actions);
    const area = document.createElement('textarea');
    area.id = 'text-' + block.id;
    area.className = 'writing';
    area.rows = 1;
    area.maxLength = 2000000;
    area.value = block.text;
    area.placeholder = '直接写下一段要求…';
    area.addEventListener('focus', () => selectBlock(block.id));
    area.addEventListener('input', () => {
      block.text = area.value;
      resize(area);
      changed();
      selectBlock(block.id);
    });
    wrap.append(head, area);
    el('document-blocks').appendChild(wrap);
  }

  function syncVariables(names) {
    const signature = JSON.stringify(names);
    if (signature === variableSignature) return;
    variableSignature = signature;
    const container = el('variable-inputs');
    container.replaceChildren();
    if (!names.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '正文中暂无变量。';
      container.appendChild(empty);
    }
    names.forEach((name, index) => {
      const label = document.createElement('label');
      label.className = 'field-label';
      label.htmlFor = 'variable-' + index;
      label.textContent = '{{' + name + '}}';
      const input = document.createElement('textarea');
      input.className = 'variable-field';
      input.id = 'variable-' + index;
      input.rows = 2;
      input.maxLength = 2000000;
      input.value = Object.prototype.hasOwnProperty.call(project.variables, name) ? project.variables[name] : '';
      input.placeholder = '填写本次使用的值';
      input.addEventListener('input', () => { project.variables[name] = input.value; changed(); });
      container.append(label, input);
    });
  }

  function checkRow(pass, text) {
    const row = document.createElement('div');
    row.className = 'check-row' + (pass ? '' : ' bad');
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.textContent = pass ? '✓' : '!';
    mark.setAttribute('aria-hidden', 'true');
    const value = document.createElement('span');
    value.textContent = (pass ? '通过 · ' : '待补充 · ') + text;
    row.append(mark, value);
    el('check-results').appendChild(row);
  }

  function updateDerived() {
    compiled = C.compile(project);
    syncVariables(compiled.variables);
    el('preview-text').textContent = compiled.text;
    el('preview-meta').textContent = (compiled.variables.length - compiled.missing.length) + ' 个变量已填写 · ' + (project.includeSnippet ? '1' : '0') + ' 个引用片段 · 作者备注已排除';
    const problems = compiled.errors.map((item) => item.message);
    if (compiled.missing.length) problems.push('缺少变量值：' + compiled.missing.join('、'));
    if (!compiled.bodyPresent) problems.push('正文尚未填写。');
    el('preview-warning').textContent = problems.join('\n');
    el('preview-warning').hidden = !problems.length;
    el('snippet-reference').hidden = !project.includeSnippet;
    el('check-results').replaceChildren();
    checkRow(compiled.bodyPresent, compiled.bodyPresent ? '正文有可发送内容' : '正文尚未填写');
    checkRow(!compiled.errors.length, compiled.errors.length ? compiled.errors.map((item) => item.message).join(' ') : '变量占位符格式完整');
    checkRow(!compiled.missing.length, compiled.missing.length ? '缺少输入：' + compiled.missing.join('、') : (compiled.variables.length ? '全部变量已填写' : '没有待填写变量'));
    el('character-count').textContent = '发送内容 ' + compiled.chars.toLocaleString('zh-CN') + ' 字符';
    document.title = (project.title || '未命名文稿') + ' — Prompt 文稿';
  }

  function renderProject() {
    el('document-title').value = project.title;
    el('author-note').value = project.authorNote;
    el('include-snippet').checked = project.includeSnippet;
    el('document-blocks').replaceChildren();
    project.blocks.forEach(createBlock);
    variableSignature = null;
    updateDerived();
    if (!project.blocks.some((item) => item.id === selected)) selected = project.blocks[0].id;
    selectBlock(selected);
    refreshMoveButtons();
    resizeAll();
  }

  function showView(next) {
    view = next;
    for (const name of ['edit', 'preview', 'history']) {
      el(name + '-panel').hidden = name !== next;
      el(name + '-tab').setAttribute('aria-selected', String(name === next));
    }
    if (next === 'edit') resizeAll();
    if (next === 'history') renderHistory();
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY, JSON.stringify(history)); return true; }
    catch (error) { return false; }
  }

  function snapshot(reason, announce) {
    try {
      const captured = C.clone(project);
      const latest = history[0];
      if (!latest || C.serialize(latest.project) !== C.serialize(captured)) {
        history.unshift({ id: C.id(), time: new Date().toISOString(), reason, project: captured });
        history = history.slice(0, 20);
      }
      const saved = saveHistory();
      if (announce) notify(saved ? '已保存本机快照。长期备份请下载项目文件。' : '快照暂存在本窗口，无法保存到本机。请下载项目文件备份。');
      if (view === 'history') renderHistory();
      return saved;
    } catch (error) {
      if (announce) notify('无法建立快照：' + error.message);
      return false;
    }
  }

  function renderHistory() {
    const list = el('history-list');
    list.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('p');
      empty.className = 'subtle';
      empty.textContent = '还没有快照。可以在文稿页点击“保存快照”。';
      list.appendChild(empty);
      return;
    }
    history.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const description = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.project.title || '未命名文稿';
      const time = document.createElement('small');
      const date = new Date(item.time);
      time.textContent = (Number.isNaN(date.valueOf()) ? item.time : date.toLocaleString('zh-CN', { hour12: false })) + ' · ' + item.reason;
      description.append(title, time);
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      actions.append(button('导出', () => downloadProject(item.project)), button('恢复', () => {
        if (!window.confirm('恢复这个快照？当前文稿会先尝试保存为新的历史快照。')) return;
        replaceProject(C.clone(item.project), '恢复快照之前');
      }));
      row.append(description, actions);
      list.appendChild(row);
    });
  }

  function replaceProject(next, reason) {
    const valid = C.validateProject(next);
    if (!snapshot(reason, false) && !window.confirm('无法把当前内容写入本机历史。请先保存项目备份。仍要切换文稿吗？')) return false;
    project = valid;
    selected = project.blocks[0].id;
    project.updatedAt = new Date().toISOString();
    dirty = true;
    renderProject();
    showView('edit');
    if (!paused) persistNow();
    else saveStatus('当前文稿尚未更新自动恢复副本', true);
    return true;
  }

  function download(text, name, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadProject(value) {
    try {
      const data = C.serialize(value || project);
      if (!value || value === project) persistNow();
      download(data, C.safeFilename((value || project).title) + '.prompt.json', 'application/json;charset=utf-8');
      notify('项目下载已发起，请在下载目录中确认 .prompt.json 文件。');
    } catch (error) { notify('无法保存项目：' + error.message); }
  }

  function confirmIncomplete() {
    updateDerived();
    if (!compiled.errors.length && !compiled.missing.length && compiled.bodyPresent) return true;
    return window.confirm('文稿中还有未填写的输入、格式问题或空正文。是否仍按当前预览导出？');
  }

  function exportText(extension) {
    if (!confirmIncomplete()) return;
    download('\uFEFF' + compiled.text.replace(/\r?\n/g, '\r\n'), C.safeFilename(project.title) + '.' + extension, 'text/plain;charset=utf-8');
    notify('发送内容下载已发起。作者备注未包含在导出文件中。');
  }

  async function copyPreview() {
    if (!confirmIncomplete()) return;
    const text = compiled.text;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        notify('已复制发送内容，作者备注已排除。');
        return;
      }
    } catch (error) { /* Use a user-initiated browser copy fallback below. */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.className = 'sr-only';
    document.body.appendChild(area);
    area.focus();
    area.select();
    let succeeded = false;
    try { succeeded = document.execCommand('copy'); }
    catch (error) { succeeded = false; }
    area.remove();
    el('copy-preview').focus();
    notify(succeeded ? '已复制发送内容，作者备注已排除。' : '复制未成功。请选中预览文字手动复制，或导出文件。');
  }

  async function openFile(file) {
    if (!file) return;
    if (file.size > C.MAX_FILE_BYTES) { notify('文件超过 5 MB，请选择较小的项目或文本文件。'); return; }
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const isJSON = /\.json$/i.test(file.name);
      const candidate = isJSON ? C.validateProject(JSON.parse(text)) : C.importText(text, file.name);
      if (replaceProject(candidate, '打开文件之前')) notify('已打开“' + file.name + '”。');
    } catch (error) { notify('打开失败，当前文稿已保留：' + error.message); }
  }

  el('document-title').addEventListener('input', (event) => { project.title = event.target.value; changed(); });
  el('author-note').addEventListener('input', (event) => { project.authorNote = event.target.value; resize(event.target); changed(); });
  el('include-snippet').addEventListener('change', (event) => { project.includeSnippet = event.target.checked; changed(); });
  el('block-type').addEventListener('change', (event) => {
    const block = project.blocks.find((item) => item.id === selected);
    if (!block) return;
    block.type = event.target.value;
    el('block-' + block.id).querySelector('.block-label').textContent = block.type;
    selectBlock(block.id);
    changed();
  });
  el('add-block').addEventListener('click', () => {
    if (project.blocks.length >= 500) { notify('一份项目最多包含 500 个段落。'); return; }
    const block = { id: C.id(), type: '正文', text: '' };
    project.blocks.push(block);
    createBlock(block);
    refreshMoveButtons();
    changed();
    el('text-' + block.id).focus();
    resize(el('text-' + block.id));
  });
  ['edit', 'preview', 'history'].forEach((name) => el(name + '-tab').addEventListener('click', () => showView(name)));
  el('check-document').addEventListener('click', () => {
    updateDerived();
    notify(compiled.errors.length || compiled.missing.length || !compiled.bodyPresent ? '文稿检查已更新，请查看右侧待补充项目。' : '文稿结构与输入检查通过。没有运行模型或工具。');
  });
  el('snapshot-document').addEventListener('click', () => snapshot('手动快照', true));
  el('save-document').addEventListener('click', () => downloadProject());
  el('open-document').addEventListener('click', () => el('file-picker').click());
  el('file-picker').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    openFile(file);
    event.target.value = '';
  });
  el('new-document').addEventListener('click', () => {
    if (!window.confirm('新建一份空白文稿？当前文稿会先尝试保存为历史快照。')) return;
    replaceProject(C.importText('', '未命名文稿.txt'), '新建文稿之前');
  });
  el('copy-preview').addEventListener('click', copyPreview);
  el('export-markdown').addEventListener('click', () => exportText('md'));
  el('export-text').addEventListener('click', () => exportText('txt'));
  el('help-open').addEventListener('click', () => el('help-dialog').showModal());
  el('help-close').addEventListener('click', () => el('help-dialog').close());
  el('conflict-download').addEventListener('click', () => downloadProject());
  el('load-remote').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { notify('没有可读取的自动恢复副本。请保存本窗口项目后再继续。'); return; }
      const external = unpack(raw);
      if (!window.confirm('读取本机的最新副本并替换当前窗口内容？如需保留当前修改，请先保存项目。')) return;
      project = external;
      selected = project.blocks[0].id;
      lastSavedRaw = raw;
      lastSavedProject = C.serialize(project);
      dirty = false;
      paused = false;
      el('storage-conflict').hidden = true;
      warning('');
      renderProject();
      saveStatus('已读取本机最新副本');
    } catch (error) { notify('无法读取该副本：' + error.message); }
  });
  el('keep-local').addEventListener('click', () => {
    if (!window.confirm('继续使用本窗口内容并覆盖本机自动恢复副本？另一窗口中的修改不会合并。建议先保存项目文件。')) return;
    try { lastSavedRaw = localStorage.getItem(KEY); }
    catch (error) { notify('本机存储仍不可用，请保存项目文件。'); return; }
    lastSavedProject = '';
    paused = false;
    el('storage-conflict').hidden = true;
    persistNow();
  });
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  document.addEventListener('keydown', (event) => {
    if (composing || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key.toLowerCase() === 's') { event.preventDefault(); downloadProject(); }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); el('file-picker').click(); }
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === KEY && event.newValue !== lastSavedRaw) pauseForConflict();
    if (event.key === HISTORY && event.newValue) {
      try {
        const remote = JSON.parse(event.newValue);
        if (Array.isArray(remote)) history = remote.slice(0, 20).map((item) => ({ id: item.id, time: item.time, reason: item.reason, project: C.validateProject(item.project) }));
        if (view === 'history') renderHistory();
      } catch (error) { /* Keep the last valid history already in memory. */ }
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty && !persistNow()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty && !paused) persistNow(); });
  window.addEventListener('resize', resizeAll);
  el('version').textContent = C.VERSION;
  loadLocal();
  renderProject();
  if (!lastSavedRaw && !paused) persistNow();
})();
