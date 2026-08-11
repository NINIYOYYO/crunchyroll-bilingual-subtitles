// ==========================================
// background.js - 强力抗错位 ID 锚定 + 自动重传版 + 实时流式(Streaming)支持
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_batch") {
        handleBatchTranslation(request.lines, request.settings)
            .then(res => sendResponse({ success: true, data: res }))
            .catch(err => {
                console.error("[CR Bilingual Subtitles] Batch translation failed:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});

// ✨ 长连接(Port)流式通道：content script 通过该通道实时接收逐字生成的翻译
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'translate_stream') return;
    port.onMessage.addListener(async (msg) => {
        if (msg && msg.action === 'translate_stream') {
            try {
                await handleStreamTranslation(msg.lines, msg.settings, port);
            } catch (e) {
                console.error("[CR Bilingual Subtitles] Stream translation crashed:", e);
                port.postMessage({ type: 'done', success: false, error: e.message });
            }
        }
    });
});

// ====================================================
// ✨ 共享工具：构建请求体 / 严格解析 / 流式增量解析
// ====================================================

/**
 * 辅助函数：安全提取字幕项的 ID 与文本（支持对象 { id, text } 或纯字符串）
 */
function getItemId(item, index) {
    return (item && typeof item === 'object' && item.id !== undefined) ? item.id : index;
}

function getItemText(item) {
    return (item && typeof item === 'object' && item.text !== undefined) ? item.text : String(item);
}

/**
 * 构建发送给 LLM 的 Payload，采用全集绝对 Cue ID 锚点 `[ID:${item.id}]` 格式。
 * 单行台词内部的换行符被转义为 ` ||| `，严格保证 1 行对 1 锚点，彻底杜绝模型重新编号引发的错位。
 *
 * @param {Array<Object|string>} lines - 待翻译的原文字幕数组 (对象 { id, text } 或纯字符串)。
 * @param {Object} settings - 扩展设置。
 * @returns {Object} 包含模型 API 请求体的 Payload 对象。
 */
function buildTranslationPayload(lines, settings) {
    const { secondLang, aiModel, reasoningEnabled } = settings;
    const reasoningOn = reasoningEnabled !== false;
    const isOpenAIReason = aiModel && (aiModel.includes('o1') || aiModel.includes('o3'));

    let effortPrompt = "";
    if (!reasoningOn) {
        effortPrompt = "\n[CRITICAL WARNING]: SKIP ALL REASONING. IMMEDIATELY output the final PAL-Align text.";
    }

    // 构造物理锚点输入：[ID:${item.id}] 文本，换行符转义为 |||
    const promptLines = lines.map((item, index) => `[ID:${getItemId(item, index)}] ${getItemText(item).replace(/\r?\n/g, ' ||| ')}`);

    const payload = {
        model: aiModel || "gpt-3.5-turbo",
        messages: [
            {
                role: "system",
                content: `You are an expert anime subtitle translator. Translate each subtitle line into ${secondLang}.
HARD PHYSICAL ALIGNMENT RULES:
1. You MUST strictly preserve the exact [ID:number] physical anchor tag at the start of every line.
2. Keep a strict 1-to-1 mapping for every ID tag. DO NOT omit any [ID:number] tag or merge lines.
3. If a line contains ' ||| ', preserve the ' ||| ' separator in the translated line!
4. Format output strictly line by line without markdown formatting or code blocks:
[ID:0] translated text 0
[ID:1] translated text 1${effortPrompt}`
            },
            { role: "user", content: promptLines.join('\n') }
        ],
        temperature: 0.1
    };

    if (isOpenAIReason) {
        payload.reasoning_effort = reasoningOn ? "medium" : "low";
    } else if (!reasoningOn) {
        payload.reasoning = { enabled: false };
    }

    return payload;
}

function buildRequestHeaders(apiKey) {
    const headers = {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://www.crunchyroll.com',
        'X-Title': 'CR Dual Subs Plugin'
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    return headers;
}

/**
 * 解析 PAL-Align 物理锚点输出 `[ID:${item.id}] 译文`。
 * 精确按照 item.id 匹配，杜绝由于模型跳过前几句引发的索引归零移位。
 *
 * @param {string} content - 模型输出文本。
 * @param {Array<Object|string>} lines - 原始原文数组。
 * @returns {Object} { translatedArray, validKeysCount, missingIndices, parsedMap }
 */
function parsePalAlignOutput(content, lines) {
    const cleaned = content.trim().replace(/```[a-z]*/gi, '').trim();
    const translatedArray = lines.map(item => getItemText(item));
    const missingIndices = [];
    const parsedMap = {};

    const rawLines = cleaned.split(/\r?\n/);
    let currentCid = null;

    for (const rawLine of rawLines) {
        const lineStr = rawLine.trim();
        if (!lineStr) continue;

        const match = lineStr.match(/^\[ID:(\d+)\]\s*(.*)$/);
        if (match) {
            currentCid = parseInt(match[1], 10);
            const val = match[2].trim().replace(/\s*\|\|\|\s*/g, '\n');
            if (val) parsedMap[currentCid] = val;
        } else if (currentCid !== null) {
            const valClean = lineStr.replace(/\s*\|\|\|\s*/g, '\n');
            const existing = parsedMap[currentCid] || "";
            parsedMap[currentCid] = existing ? `${existing}\n${valClean}` : valClean;
        }
    }

    let validKeysCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const id = getItemId(lines[i], i);
        if (parsedMap[id] !== undefined && String(parsedMap[id]).trim() !== "") {
            translatedArray[i] = String(parsedMap[id]).trim();
            validKeysCount++;
        } else {
            missingIndices.push(i);
        }
    }

    return { translatedArray, validKeysCount, missingIndices, parsedMap };
}

/**
 * 兼容性 JSON 解析器（当模型忽略物理锚点直接返回 JSON 时的降级解析）。
 *
 * @param {string} content - 模型输出文本。
 * @param {Array<Object|string>} lines - 原始原文数组。
 * @returns {Object} { translatedArray, validKeysCount, missingIndices }
 */
function parseJsonTranslations(content, lines) {
    const cleaned = content.trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const translatedArray = lines.map(item => getItemText(item));
    const missingIndices = [];

    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
        return { translatedArray, validKeysCount: 0, missingIndices: lines.map((_, i) => i) };
    }

    try {
        const parsedObj = JSON.parse(cleaned.substring(first, last + 1));
        let validKeysCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const id = getItemId(lines[i], i);
            const translatedLine = parsedObj[id] !== undefined ? parsedObj[id] : (parsedObj[i] !== undefined ? parsedObj[i] : parsedObj[String(i)]);
            if (translatedLine !== undefined && translatedLine !== null && String(translatedLine).trim() !== "") {
                translatedArray[i] = String(translatedLine).trim();
                validKeysCount++;
            } else {
                missingIndices.push(i);
            }
        }
        return { translatedArray, validKeysCount, missingIndices };
    } catch (e) {
        return { translatedArray, validKeysCount: 0, missingIndices: lines.map((_, i) => i) };
    }
}

/**
 * 统一解析入口：优先走 PAL-Align 物理锚点解析，失败则降级走 JSON 解析。
 * 包含软卡点阈值判断。
 *
 * @param {string} content - 模型响应文本。
 * @param {Array<string>} lines - 原始原文数组。
 * @returns {Object} { translatedArray, missingIndices }
 */
function parseModelTranslations(content, lines) {
    let res = parsePalAlignOutput(content, lines);
    if (res.validKeysCount === 0) {
        res = parseJsonTranslations(content, lines);
    }

    const minRequiredKeys = Math.max(1, Math.ceil(lines.length * 0.6));
    if (res.validKeysCount < minRequiredKeys) {
        throw new Error(`LLM alignment failed: expected at least ${minRequiredKeys} keys, but only matched ${res.validKeysCount}`);
    }

    return res;
}

/**
 * 方案二：漏句增量二次补译 (Incremental Repair Batch)。
 * 当主批次成功翻译了大部分台词但遗漏了少数尾句/漏行 (missingIndices) 时，
 * 触发一次极小的增量补救 API 请求，单独补译漏掉的这几行。
 *
 * @param {Array<number>} missingIndices - 缺失句在原数组中的索引。
 * @param {Array<string>} lines - 原始台词数组。
 * @param {Object} settings - 扩展配置。
 * @returns {Promise<Object>} { [origIndex]: repairedText } 补译字典。
 */
async function repairMissingCues(missingIndices, lines, settings) {
    if (!missingIndices || missingIndices.length === 0) return {};
    // 如果缺失行超过 40%，说明整体质量差，交给主重试循环，不进行微型增量补译
    if (missingIndices.length > Math.ceil(lines.length * 0.4)) return {};

    const repairLines = missingIndices.map(idx => lines[idx]);
    const payload = buildTranslationPayload(repairLines, settings);
    const headers = buildRequestHeaders(settings.apiKey);

    try {
        const res = await fetch(settings.apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!res.ok) return {};
        const data = await res.json();
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (!content) return {};

        const { translatedArray, validKeysCount } = parsePalAlignOutput(content, repairLines);
        const repairedMap = {};

        if (validKeysCount > 0) {
            missingIndices.forEach((origIndex, i) => {
                if (translatedArray[i] && translatedArray[i] !== repairLines[i]) {
                    repairedMap[origIndex] = translatedArray[i];
                }
            });
        }
        return repairedMap;
    } catch (e) {
        return {};
    }
}

/**
 * 流式增量解析器：按 `[ID:X]` 物理锚点逐行提取流式文本，用于实时上屏。
 *
 * @param {string} content - 累积的流式文本。
 * @param {number} count - 预期行数。
 * @returns {Object} { [cid]: text }
 */
function extractPartialTranslations(content, count) {
    const result = {};
    const cleaned = content.replace(/```[a-z]*/gi, '');

    // 优先匹配 [ID:X] 锚点
    const regex = /\[ID:(\d+)\]\s*([^\r\n]*)/g;
    let match;
    let foundAnchors = false;

    while ((match = regex.exec(cleaned)) !== null) {
        foundAnchors = true;
        const cid = parseInt(match[1], 10);
        if (cid < count) {
            const val = match[2].trim().replace(/\s*\|\|\|\s*/g, '\n');
            result[cid] = val;
        }
    }

    // 若流式文本中尚未出现 [ID:X]，降级走 JSON 边界匹配
    if (!foundAnchors) {
        for (let i = 0; i < count; i++) {
            const keyPattern = new RegExp(`"${i}"\\s*:`);
            const matchJson = keyPattern.exec(cleaned);
            if (!matchJson) continue;

            let p = matchJson.index + matchJson[0].length;
            while (p < cleaned.length && (cleaned[p] === ' ' || cleaned[p] === '\t' || cleaned[p] === '\r' || cleaned[p] === '\n')) p++;
            if (cleaned[p] !== '"') continue;
            p++;

            let val = '';
            while (p < cleaned.length) {
                const c = cleaned[p];
                if (c === '\\') {
                    val += cleaned[p] + (cleaned[p + 1] || '');
                    p += 2;
                    continue;
                }
                if (c === '"') break;
                val += c;
                p++;
            }
            result[i] = val;
        }
    }

    return result;
}

async function handleBatchTranslation(lines, settings) {
    const { secondLang, transEngine, apiUrl, aiModel, apiKey, reasoningEnabled } = settings;
    const MAX_RETRIES = 3; // max retries: 3

    if (transEngine === 'custom_llm' && apiUrl) {
        const payload = buildTranslationPayload(lines, settings);
        const headers = buildRequestHeaders(apiKey);

        // ====================================================
        // ✨ AI Model API auto-retry loop
        // ====================================================
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });

                if (!res.ok) {
                    const errorText = await res.text();
                    const status = res.status;

                    // Critical error，直接熔断（Key 错误、接口地址错误、余额不足等）
                    if (status === 401 || status === 403 || status === 404 || status === 402) {
                        throw new Error(`Critical error HTTP ${status}: ${errorText.substring(0, 40)}`);
                    }

                    // 非Critical error（429 限流、500/502 服务器崩溃），抛出异常交给重试机制
                    throw new Error(`HTTP ${status}: ${errorText.substring(0, 40)}`);
                }

                const data = await res.json();
                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error("Interface returned malformed data, missing choices[0].message");
                }

                const content = (data.choices[0].message.content || '').trim();
                const parsedRes = parseModelTranslations(content, lines);
                let translatedArray = parsedRes.translatedArray;

                const autoRepairOn = settings.autoRepairEnabled !== false;
                // ✨ 方案二：漏句增量二次补译 (用户可选开启，当模型漏掉尾句或少数 Cue 时自动救援)
                if (autoRepairOn && parsedRes.missingIndices && parsedRes.missingIndices.length > 0) {
                    const repairedMap = await repairMissingCues(parsedRes.missingIndices, lines, settings);
                    Object.keys(repairedMap).forEach(idxStr => {
                        const idx = parseInt(idxStr, 10);
                        translatedArray[idx] = repairedMap[idx];
                    });
                }

                return translatedArray;

            } catch (e) {
                lastError = e;
                // 如果是Critical error，停止重试
                if (e.message.includes('Critical error')) throw e;

                // 如果已经达到最大重试次数，抛出最终错误
                if (attempt === MAX_RETRIES) break;

                // 计算退避延迟 (Exponential Backoff)，如果是 429 错误则惩罚时间翻倍
                let delay = 1000 * attempt;
                if (e.message.includes('429')) delay = 2500 * attempt;

                console.warn(`[CR Bilingual Subtitles] Model request failed or misaligned, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`, e.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        throw new Error(`Retried ${MAX_RETRIES} attempts, failed: ${lastError.message}`);

    } else {
        // ====================================================
        // ✨ Google 机翻 自动重试循环
        // ====================================================
        const tl = secondLang === 'zh-HK' ? 'zh-TW' : secondLang.split('-')[0];
        const delimiter = '\n\n|||\n\n'; 
        const joinedText = lines.join(delimiter); 
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(joinedText)}`;
        
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    if (res.status === 429) throw new Error("429 Too Many Requests");
                    throw new Error(`HTTP ${res.status}`);
                }
                
                const data = await res.json();
                const fullTranslatedText = data[0].map(item => item[0]).join('');
                
                let translatedArray = fullTranslatedText.split(/\n\n\|\|\|\n\n/);
                if (translatedArray.length < lines.length) {
                    translatedArray = fullTranslatedText.split('\n\n'); 
                }
                
                while (translatedArray.length < lines.length) translatedArray.push(chrome.i18n.getMessage("toast_translation_missing") || "[Translation missing]");
                return translatedArray.slice(0, lines.length);

            } catch (e) {
                lastError = e;
                if (attempt === MAX_RETRIES) break;
                
                let delay = 1500 * attempt;
                if (e.message.includes('429')) delay = 3000 * attempt; // Google 429 惩罚期更长
                
                console.warn(`[CR Bilingual Subtitles] Google translation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        
        throw new Error(`Google 机翻重试 ${MAX_RETRIES} 次后失败: ${lastError.message}`);
    }
}

// ====================================================
// ✨ 流式翻译：开启 stream:true，逐 token 解析并实时回传 partial，结束回传 done
// 兼容两种情况：
//   1) 支持 SSE 的端点 -> 解析 data: 行，增量拼出 content
//   2) 不支持 stream 的端点 -> 回退为一次性解析整包 chat completion
// ====================================================
async function handleStreamTranslation(lines, settings, port) {
    const { transEngine, apiUrl, aiModel, apiKey } = settings;

    // 非 custom_llm（如 Google 机翻）无法流式，直接走批量逻辑后回传 done
    if (transEngine !== 'custom_llm' || !apiUrl) {
        try {
            const res = await handleBatchTranslation(lines, settings);
            port.postMessage({ type: 'done', success: true, translations: res });
        } catch (e) {
            port.postMessage({ type: 'done', success: false, error: e.message });
        }
        return;
    }

    const payload = buildTranslationPayload(lines, settings);
    payload.stream = true;
    const headers = buildRequestHeaders(apiKey);

    const MAX_RETRIES = 3;
    let lastError = null;
    let lastPartialsSig = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });

            if (!res.ok) {
                const errorText = await res.text();
                const status = res.status;
                if (status === 401 || status === 403 || status === 404 || status === 402) {
                    throw new Error(`Critical error HTTP ${status}: ${errorText.substring(0, 40)}`);
                }
                throw new Error(`HTTP ${status}: ${errorText.substring(0, 40)}`);
            }

            if (!res.body || !res.body.getReader) {
                throw new Error("Endpoint does not support streaming response body");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let rawBody = '';
            let fullContent = '';    // SSE content 增量（最终答案）
            let fullReasoning = '';  // SSE reasoning / reasoning_content 增量（部分模型把答案放在这里）
            let gotSSE = false;      // 是否真的收到了 SSE data: 增量
            let streamDone = false;

            const streamedText = () => fullContent + fullReasoning;

            while (true) {
                const { done, value } = await reader.read();
                if (done) { streamDone = true; break; }
                const chunkStr = decoder.decode(value, { stream: true });
                buffer += chunkStr;
                rawBody += chunkStr;

                let nl;
                while ((nl = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, nl).trim();
                    buffer = buffer.slice(nl + 1);
                    if (!line) continue;

                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();
                        if (data === '[DONE]') { streamDone = true; break; }
                        try {
                            const json = JSON.parse(data);
                            const choice = (json.choices && json.choices[0]) || {};
                            const deltaObj = choice.delta || {};
                            const contentDelta = deltaObj.content || (choice.message && choice.message.content) || '';
                            const reasoningDelta = deltaObj.reasoning || deltaObj.reasoning_content || '';
                            if (contentDelta) { gotSSE = true; fullContent += contentDelta; }
                            if (reasoningDelta) { gotSSE = true; fullReasoning += reasoningDelta; }
                            if (contentDelta || reasoningDelta) {
                                const partial = extractPartialTranslations(streamedText(), lines.length);
                                const sig = JSON.stringify(partial);
                                if (sig !== lastPartialsSig) {
                                    lastPartialsSig = sig;
                                    port.postMessage({ type: 'partial', translations: partial });
                                }
                            }
                        } catch (e) {
                            // 忽略非 JSON 的 SSE 控制行（如 : keep-alive）
                        }
                    }
                }
                if (streamDone) break;
            }

            // 若端点忽略了 stream:true，回退为解析整包 chat completion
            if (!gotSSE) {
                try {
                    const env = JSON.parse(rawBody);
                    const content = (env.choices && env.choices[0] && env.choices[0].message && env.choices[0].message.content) || '';
                    if (!content) throw new Error('No content in response');
                    fullContent = content;
                } catch (e) {
                    throw new Error('Streaming unsupported and response is not a valid chat completion');
                }
            }

            // 最终解析：优先用 content（更干净），否则回退到 content + reasoning 组合
            let parsedRes = null;
            if (fullContent) {
                try { parsedRes = parseModelTranslations(fullContent, lines); } catch (e) { parsedRes = null; }
            }
            if (!parsedRes) {
                parsedRes = parseModelTranslations(streamedText(), lines);
            }
            let translatedArray = parsedRes.translatedArray;

            const autoRepairOn = settings.autoRepairEnabled !== false;
            // ✨ 方案二：漏句增量二次补译 (用户可选开启)
            if (autoRepairOn && parsedRes.missingIndices && parsedRes.missingIndices.length > 0) {
                const repairedMap = await repairMissingCues(parsedRes.missingIndices, lines, settings);
                Object.keys(repairedMap).forEach(idxStr => {
                    const idx = parseInt(idxStr, 10);
                    translatedArray[idx] = repairedMap[idx];
                });
            }

            port.postMessage({ type: 'done', success: true, translations: translatedArray });
            return;

        } catch (e) {
            lastError = e;
            if (e.message.includes('Critical error')) {
                port.postMessage({ type: 'done', success: false, error: e.message });
                return;
            }
            if (attempt === MAX_RETRIES) break;

            let delay = 1000 * attempt;
            if (e.message.includes('429')) delay = 2500 * attempt;

            console.warn(`[CR Bilingual Subtitles] Stream request failed or misaligned, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`, e.message);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    port.postMessage({ type: 'done', success: false, error: `Retried ${MAX_RETRIES} attempts, failed: ${lastError ? lastError.message : 'unknown'}` });
}