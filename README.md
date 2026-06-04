# Crunchyroll AI Bilingual Subtitles / Crunchyroll AI 双语字幕

[English](#english) | [中文](#中文)

---

## English

### Overview
A Chrome extension that provides AI-powered bilingual subtitles for Crunchyroll. It bypasses CSP restrictions and supports real-time subtitle position and size adjustments.

### Features
- **AI Translation**: Supports custom AI models (OpenRouter, Kimi, etc.)
- **Google Translate Fallback**: Free translation when AI is unavailable
- **Real-time Adjustment**: Adjust subtitle size and position directly in the player
- **Multi-language Support**: 14+ target languages
- **i18n Support**: 15+ UI languages (English, 简体中文, 繁體中文, 日本語, 한국어, etc.)

### Installation
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension directory

### Usage
1. Click the extension icon to open settings
2. Choose your target language (e.g., zh-CN for Simplified Chinese)
3. Select translation mode:
   - **Official First, AI Fallback**: Use official subs, AI translates missing ones
   - **Force AI Translation**: Always use AI translation
   - **Official Only**: Only show official subtitles
4. Configure AI settings (if using custom model):
   - API Endpoint (default: OpenRouter)
   - Model name (e.g., moonshotai/kimi-k2.5-0127)
   - API Key
   - Reasoning effort level
5. Click "Save Settings & Refresh Page"

### Supported Languages
- 简体中文 (zh-CN), 繁體中文 (zh-HK)
- English (en-US), Español (es-ES, es-419)
- Português (pt-BR), Français (fr-FR)
- Deutsch (de-DE), Italiano (it-IT)
- Русский (ru-RU), العربية (ar-SA)
- Tiếng Việt (vi-VN), ไทย (th-TH)
- Bahasa Indonesia (id-ID), Bahasa Melayu (ms-MY)

### Translation Engines
- **Custom AI Model (Recommended)**: OpenRouter, Kimi, or any OpenAI-compatible API
- **Google Free Translation**: No API key required, but may be less accurate

### License
This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

---

## 中文

### 简介
一款为 Crunchyroll 提供 AI 双语字幕的 Chrome 扩展。突破 CSP 限制，支持播放器内实时调节字幕位置和大小。

### 功能特性
- **AI 翻译**：支持自定义大模型（OpenRouter、Kimi 等）
- **Google 翻译兜底**：AI 不可用时自动降级到免费翻译
- **播放器内调节**：直接在播放器中调整字幕大小和位置
- **多语言支持**：14+ 种目标语言
- **国际化支持**：15+ 种界面语言（英语、简体中文、繁體中文、日本語、한국어 等）

### 安装方法
1. 下载或克隆本仓库
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"，选择本扩展目录

### 使用方法
1. 点击扩展图标打开设置面板
2. 选择目标语言（如简体中文 zh-CN）
3. 选择翻译模式：
   - **官方优先，AI 兜底**：优先使用官方字幕，缺失部分用 AI 翻译
   - **强制 AI 翻译**：始终使用 AI 翻译
   - **仅官方字幕**：只显示官方字幕
4. 配置 AI 设置（如使用自定义模型）：
   - API 接口地址（默认：OpenRouter）
   - 模型名称（如：moonshotai/kimi-k2.5-0127）
   - API Key
   - 推理力度级别
5. 点击"保存设置并刷新页面"

### 支持的语言
- 简体中文 (zh-CN)、繁體中文 (zh-HK)
- English (en-US)、Español (es-ES, es-419)
- Português (pt-BR)、Français (fr-FR)
- Deutsch (de-DE)、Italiano (it-IT)
- Русский (ru-RU)、العربية (ar-SA)
- Tiếng Việt (vi-VN)、ไทย (th-TH)
- Bahasa Indonesia (id-ID)、Bahasa Melayu (ms-MY)

### 翻译引擎
- **自定义大模型（推荐）**：OpenRouter、Kimi 或任何兼容 OpenAI API 的服务
- **Google 免费翻译**：无需 API Key，但准确度可能较低

### 开源协议
本项目采用 GNU General Public License v3.0 开源协议 - 详见 [LICENSE](LICENSE) 文件。

---

### Contributing / 贡献
Contributions are welcome! Feel free to submit issues and pull requests.
欢迎贡献！欢迎提交 issue 和 pull request。
