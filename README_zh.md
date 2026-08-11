# Crunchyroll AI 双语字幕扩展

<p align="center">
  <b>基于大模型物理锚定对齐与绝对 Cue ID 的 Crunchyroll 高精度 AI 双语字幕扩展</b><br>
  <span>利用 LLM 物理锚点技术实现字幕精准对齐与零错位同屏渲染</span>
</p>

<p align="center">
  <a href="README.md"><b>English Documentation (英文文档)</b></a>
</p>

<p align="center">
  <img src="assets/zh-cn.png" width="400" alt="设置面板" />
</p>

---

## 项目简介

**Crunchyroll AI 双语字幕扩展**是一款专为 Crunchyroll 视频平台开发的高性能 Chrome 浏览器扩展。本项目成功突破浏览器 Content Security Policy (CSP) 限制，集成大语言模型（LLM）与降级翻译引擎，实现高精度、低延迟的双语字幕同屏渲染。

本扩展首创**全集绝对 Cue ID 物理锚定对齐架构**（Absolute Cue ID Anchoring）与 **PAL-Align 协议**，彻底解决视频任意快进跳转、大模型跳过无意义语气词以及多行台词合并引发的时间轴错位与字幕乱跳痛点。

---

## 功能特性

- **AI 智能双语字幕**：支持自定义大模型（DeepSeek、Kimi 等），双语字幕同屏实时显示。
- **快进跳转零错位**：全集绝对 Cue ID 绑定，无论怎么拉动进度条或模型跳过叹气，字幕始终精准对齐，绝不乱跳。
- **漏句自动补译**：AI 遗漏尾句或特殊音效时，自动单独发起定向重试补齐。
- **逐字流式打字机显示**：支持打字机般逐字实时上屏，无需等待整句完成。
- **播放器内随意调节**：直接在 Crunchyroll 视频画面中自由调整字幕字号大小、颜色与显示位置。
- **支持 32 种目标翻译语言**：轻松翻译为中文、英语、日语、韩语、西班牙语、法语、德语等 32 种全球语言。
- **支持 15 种界面多语言**：扩展设置面板支持中、英、日、韩、法、德、俄等 15 种原生语言。

---

## 语言能力矩阵

### 支持的目标翻译语言 (32 种)
翻译引擎支持将字幕翻译为 **32 种全球目标语言**：

| 语系 / 地区 | 支持的目标语言 |
| :--- | :--- |
| **东亚语系** | 简体中文 (`zh-CN`)、繁体中文 (`zh-HK`)、日语 (`ja-JP`)、韩语 (`ko-KR`) |
| **欧洲与西方语系** | 英语 (`en-US`)、拉美西班牙语 (`es-419`)、西班牙西班牙语 (`es-ES`)、巴西葡萄牙语 (`pt-BR`)、法语 (`fr-FR`)、德语 (`de-DE`)、意大利语 (`it-IT`)、俄语 (`ru-RU`)、波兰语 (`pl-PL`)、荷兰语 (`nl-NL`)、瑞典语 (`sv-SE`)、芬兰语 (`fi-FI`)、挪威语 (`no-NO`)、丹麦语 (`da-DK`)、捷克语 (`cs-CZ`)、匈牙利语 (`hu-HU`)、罗马尼亚语 (`ro-RO`)、乌克兰语 (`uk-UA`)、希腊语 (`el-GR`) |
| **中东与亚非语系** | 阿拉伯语 (`ar-SA`)、土耳其语 (`tr-TR`)、希伯来语 (`he-IL`)、印地语 (`hi-IN`)、越南语 (`vi-VN`)、泰语 (`th-TH`)、印尼语 (`id-ID`)、马来语 (`ms-MY`)、他加禄语 (`tl-PH`) |

### 支持的界面语言 (15 种)
扩展的设置面板原生支持 **15 种国际化 UI 语言**：

- 简体中文 (`zh_CN`)、繁體中文 (`zh_TW`)、English (`en`)、日本語 (`ja`)、한국어 (`ko`)
- Español (`es`)、Français (`fr`)、Deutsch (`de`)、Русский (`ru`)、Português - BR (`pt_BR`)
- Tiếng Việt (`vi`)、ไทย (`th`)、Bahasa Indonesia (`id`)、Bahasa Melayu (`ms`)、العربية (`ar`)

---

## 安装指南

1. 下载或克隆本仓库：
   ```bash
   git clone https://github.com/NINIYOYYO/crunchyroll-bilingual-subtitles.git
   ```
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
3. 开启右上角的**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择本扩展项目根目录。

---

## 使用与配置说明

1. 点击浏览器工具栏的扩展图标打开设置面板。
2. 在 **Target Language** 下拉菜单中选择目标翻译语言（共 32 种可选）。
3. 选择翻译模式：
   - **官方优先，AI 兜底**：优先显示官方原生字幕，缺失部分由 AI 补译。
   - **强制 AI 翻译**：全程使用大模型翻译，获得更高上下文连贯性。
   - **仅官方字幕**：仅显示官方原生字幕。
4. （可选）配置自定义 AI 提供商参数：
   - **API 端点**：兼容 OpenAI 的接口地址（默认：`https://openrouter.ai/api/v1`）
   - **模型标识**：如 `deepseek/deepseek-r1` 或 `moonshotai/kimi-k2.5-0127`
   - **API Key**：您的服务密钥
   - **推理力度与自动补译**：按需开启推理力度调整与漏句二次补译开关。
5. 点击**保存设置并刷新页面**生效。

---

## 开源协议

本项目采用 **GNU General Public License v3.0** 开源协议 - 详见 [LICENSE](LICENSE) 文件。

---

## 贡献指南

欢迎提交 Issue 与 Pull Request 共同改善本项目！
