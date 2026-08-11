# Crunchyroll AI Bilingual Subtitles

<p align="center">
  <b>High-Precision AI Bilingual Subtitle Extension for Crunchyroll</b><br>
  <span>High-performance subtitle translation powered by LLMs with Absolute Cue ID Anchoring</span>
</p>

<p align="center">
  <a href="README_zh.md"><b>中文文档 (Chinese Documentation)</b></a>
</p>

<p align="center">
  <img src="assets/en.png" width="400" alt="Settings Panel" />
</p>

---

## Overview

**Crunchyroll AI Bilingual Subtitles** is an enterprise-grade Chrome extension designed to deliver real-time, context-aware bilingual subtitles on Crunchyroll. Built to bypass strict Content Security Policies (CSP), it integrates custom Large Language Models (LLMs) alongside a fallback translation engine.

The extension introduces **Absolute Cue ID Anchoring** and **PAL-Align Architecture**, ensuring 100% synchronized subtitle timeline alignment even during fast-seeking, LLM line-skipping, or multi-line dialogue formatting.

---

## Features

- **AI Bilingual Subtitles**: Real-time dual-language subtitle overlay supporting custom LLMs (DeepSeek, Kimi, OpenAI-compatible APIs).
- **Zero Misalignment on Seek**: Absolute Cue ID binding guarantees 100% accurate alignment without subtitle shifting even when fast-seeking or skipping filler lines.
- **Auto-Repair Dropped Cues**: Intelligent micro-retry mechanism automatically recovers skipped sentences or sound effects.
- **Typewriter Token Streaming**: Real-time token-by-token streaming translation reduces initial display latency.
- **In-Player Customization**: Adjust font size, text colors, shadows, and vertical positions directly overlaying the video player.
- **32 Global Target Languages**: Supports translation into 32 global target languages (Chinese, English, Japanese, Korean, Spanish, French, German, etc.).
- **15 Localized UI Locales**: Settings interface fully translated across 15 native locales.

---

## Language Capabilities

### Supported Target Languages (32 Languages)
The translation engine supports output into **32 global target languages**:

| Region / Family | Languages Supported |
| :--- | :--- |
| **East Asian** | Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-HK`), Japanese (`ja-JP`), Korean (`ko-KR`) |
| **European & Western** | English (`en-US`), Spanish - LA (`es-419`), Spanish - ES (`es-ES`), Portuguese - BR (`pt-BR`), French (`fr-FR`), German (`de-DE`), Italian (`it-IT`), Russian (`ru-RU`), Polish (`pl-PL`), Dutch (`nl-NL`), Swedish (`sv-SE`), Finnish (`fi-FI`), Norwegian (`no-NO`), Danish (`da-DK`), Czech (`cs-CZ`), Hungarian (`hu-HU`), Romanian (`ro-RO`), Ukrainian (`uk-UA`), Greek (`el-GR`) |
| **Middle Eastern & Asian** | Arabic (`ar-SA`), Turkish (`tr-TR`), Hebrew (`he-IL`), Hindi (`hi-IN`), Vietnamese (`vi-VN`), Thai (`th-TH`), Indonesian (`id-ID`), Malay (`ms-MY`), Tagalog (`tl-PH`) |

### Supported UI Locales (15 Languages)
The extension settings UI is fully internationalized across **15 native locales**:

- English (`en`), Simplified Chinese (`zh_CN`), Traditional Chinese (`zh_TW`), Japanese (`ja`), Korean (`ko`)
- Spanish (`es`), French (`fr`), German (`de`), Russian (`ru`), Portuguese - BR (`pt_BR`)
- Vietnamese (`vi`), Thai (`th`), Indonesian (`id`), Malay (`ms`), Arabic (`ar`)

---

## Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/NINIYOYYO/crunchyroll-bilingual-subtitles.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extension directory.

---

## Usage & Configuration

1. Click the extension icon in the toolbar to open the settings panel.
2. Select your desired **Target Language** from the dropdown (32 languages available).
3. Select the preferred **Translation Mode**:
   - **Official First, AI Fallback**: Displays official subtitles when available, translating missing lines with AI.
   - **Force AI Translation**: Translates all subtitles using AI for maximum contextual consistency.
   - **Official Only**: Displays official native subtitles without AI intervention.
4. (Optional) Configure Custom AI Provider settings:
   - **API Endpoint**: OpenAI-compatible endpoint (Default: `https://openrouter.ai/api/v1`)
   - **Model Identifier**: e.g., `deepseek/deepseek-r1` or `moonshotai/kimi-k2.5-0127`
   - **API Key**: Your provider access key
   - **Reasoning Effort & Auto-Repair**: Toggle reasoning effort level and automatic missing cue repair.
5. Click **Save Settings & Refresh Page**.

---

## License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

---

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

