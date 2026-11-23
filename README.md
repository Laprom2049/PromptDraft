# PromptDraft（Prompt 文稿）0.1.0

> Windows 上的本地提示词编辑器：离线单页应用 + 原生 Win32 启动器，用系统 Edge 打开独立应用窗口。

## 简介

写提示词时，正文、变量和最终发送文本常常散在聊天框与笔记里，改一个变量名就要手工替换一遍。PromptDraft 把这几件事收进一个本地编辑器：

- 正文用 `{{变量名}}` 占位，侧栏填值，实时查看替换后的**发送预览**；
- 项目保存为 `.prompt.json`，可完整导出/导入，也可只导出展开后的 TXT / Markdown；
- 全程离线，不需要账号、模型 API Key 或联网。

技术上，前端是自包含的 HTML/CSS/JS：构建脚本把样式、脚本内联进模板，并把脚本 SHA-256 写进 CSP，页面不加载任何远程资源。Windows 侧是三个不依赖 CRT 的 C 程序——启动器、安装器、卸载器——安装包把页面与两个 exe 作为载荷内嵌，运行时用系统 Edge 的 `--app` 独立窗口打开本地页面。

## 功能

- 编辑标题、正文、段落用途与作者备注，增删段落；
- 用 `{{变量名}}` 定义变量，支持中文变量名（如 `{{项目名称}}`）；
- 侧栏填写变量值，查看替换后的发送预览；
- 固定「结果报告」引用片段的开关；
- 检查未填写变量、空变量名、未闭合的占位符；
- 打开项目、导入 TXT/Markdown、导出项目或发送文本、复制发送内容；
- 尝试保存本机自动恢复副本，并对保存失败、其他窗口修改冲突给出提示。

变量规则：

- 变量值按普通数据**只插入一次**，不会递归解释其中的 `{{另一变量}}`；
- 正文里要保留字面的 `{{`，写成 `\{{`；
- 作者备注随完整项目导出，但不进入发送预览、复制内容和导出的发送文本。

## 快速开始

### 方式一：安装包（推荐）

要求：Windows 10 / 11 x64，已安装较新的 Microsoft Edge。

1. 运行 `windows-package/dist/PromptDraft-Setup-0.1.0-x64.exe`；
2. 按提示安装（当前用户安装，无需管理员权限），会创建桌面与开始菜单快捷方式；
3. 从快捷方式启动，程序用 Edge 打开独立应用窗口。

安装包未做数字签名，SmartScreen 可能给出提示；是否继续请按你的系统策略决定，本项目不建议关闭系统防护。

### 方式二：直接运行源码页面

```bash
python3 prompt-draft-app/build_frontend.py
```

然后用 Edge 打开 `prompt-draft-app/index.html`。注意：直接以 `file://` 打开时，自动恢复副本受浏览器本地存储策略限制，重要内容请用「保存项目」导出。安装版启动器会指定独立的 `%LOCALAPPDATA%\PromptDraft\BrowserData`，存储行为更稳定。

## 使用

### 写一篇提示词

1. 新建或打开一个项目；
2. 填写标题，编辑正文，按需增删段落并标注用途；
3. 在正文中写 `{{project}}`、`{{项目名称}}` 这类占位符；
4. 在侧栏为每个变量填值，对照发送预览调整措辞；
5. 用检查功能确认没有漏填、空名或未闭合的占位符；
6. 复制发送内容，或导出完整项目 / TXT / Markdown。

### 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl+S` | 导出完整项目文件 |
| `Ctrl+O` | 打开项目文件或导入文本 |
| `Ctrl+Z` / `Ctrl+Y` | 文本编辑控件的撤销 / 重做 |

### 保存与备份

- 完整项目使用 `.prompt.json` 扩展名，包含正文、变量值、备注和片段状态；
- TXT / Markdown 导出只包含展开后的发送内容，不含编辑元信息；
- 导出走 Edge 的下载流程，位置取决于浏览器设置，通常在系统「下载」文件夹；
- 页面提示「下载已发起」只表示已请求下载，请确认文件确实落盘；
- 自动恢复副本不是项目备份，清理 `%LOCALAPPDATA%\PromptDraft\BrowserData` 前请先导出。

## 构建

### Windows 原生构建（0.1.0 实际采用）

依赖：Python 3、MinGW-w64 GCC（`gcc`、支持 `i386pep` 的 `ld`、`objcopy`、`objdump`）。不下载构建依赖，不链接 MSVC/Windows SDK、CRT 或第三方 DLL。

```bash
python prompt-draft-app/build_frontend.py
python windows-package/build_win.py --app-dir prompt-draft-app
```

产物在 `windows-package/dist/`，工具链与逐文件校验值见 `dist/build-report-win.json`。

### Linux 交叉编译（legacy）

`windows-package/build.py` 是早期路线：Linux 主机、GCC 14、binutils 2.44（`i386pep`、`pe-x86-64`），并借助 `elf_to_coff.py` 把 ELF 目标文件转成 COFF。

```bash
python3 prompt-draft-app/build_frontend.py
python3 windows-package/build.py --app-dir prompt-draft-app
```

前端构建会把脚本哈希写入 CSP；不要只替换成品 `index.html` 里的 JavaScript 而保留旧哈希，应修改 `src/` 后重新构建。

## 测试

```bash
node --test prompt-draft-app/tests/core.test.cjs
```

覆盖核心数据处理、中文项目序列化、变量替换与备注排除等 8 个用例。`build_frontend.py` 还会检查构建标记唯一、CSP 哈希更新，以及页面不含远程脚本/样式。

## 目录结构

```
prompt-draft-app/     前端源码（模板、CSS、JS）、构建脚本、测试、已构建 index.html
windows-package/      C 源码（launcher / installer / uninstaller）、构建脚本
  dist/               安装包与构建报告
  evidence/           Windows Sandbox 中的安装、启动、卸载取证
  review/             重定位检查脚本与报告
BUILD.txt             Linux 交叉编译路线说明
BUILD-WIN.txt         Windows 原生构建与验证记录
```

## 验证状态

- 核心 JavaScript 测试通过（8 项）；
- 安装包通过静态 PE、导入表、manifest、资源与载荷一致性检查；
- 已在 Windows Sandbox 完成安装、启动（Edge 应用窗口）与卸载取证，记录见 `windows-package/evidence/`；
- 安装包未数字签名，未做广泛机型、输入法与企业策略兼容性测试；
- 0.1.0 为预览版，建议先用测试文稿确认保存、重开、导出正常，再存重要内容。

## 已知限制

- 仅支持 Windows x64，依赖系统已安装的 Edge；
- 不内置浏览器内核，不连接模型、Shell 或 Agent 执行器；编辑器里的「约束」「验收」等标签只用于组织文稿，不会对外部 Agent 生效；
- 自动恢复依赖浏览器本地存储，可能受版本、设置或企业策略影响；
- 卸载默认保留 `BrowserData` 与已导出的项目文件。

## 许可

本仓库暂未附开源许可证，默认保留所有权利。若希望他人复用或再分发，建议补充 MIT 或 Apache-2.0 许可证后再公开。
