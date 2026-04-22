// ==========================================
// background.js - 强力抗错位 ID 锚定 + 自动重传版
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate_batch") {
        handleBatchTranslation(request.lines, request.settings)
            .then(res => sendResponse({ success: true, data: res }))
            .catch(err => {
                console.error("[CR双语插件] 批量翻译彻底失败:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; 
    }
});

async function handleBatchTranslation(lines, settings) {
    const { secondLang, transEngine, apiUrl, aiModel, apiKey, reasoningEffort } = settings;
    const MAX_RETRIES = 3; // 最大重试 3 次

    if (transEngine === 'custom_llm' && apiUrl) {
        
        // 1. 将数组转为带 ID 的对象，防止模型合并句子导致错位
        const linesObj = {};
        lines.forEach((line, index) => {
            linesObj[index] = line;
        });

        // 2. 构建推理压制策略
        let effortPrompt = "";
        let effortParam = "medium";

        switch (reasoningEffort) {
            case 'none':
                effortPrompt = "\n[CRITICAL WARNING]: SKIP ALL REASONING. IMMEDIATELY output the final JSON object.";
                effortParam = "low";
                break;
            case 'low':
                effortPrompt = "\n[RESTRICTION]: Keep reasoning EXTREMELY short.";
                effortParam = "low";
                break;
            case 'high':
            case 'ultra':
                effortPrompt = "\n[INSTRUCTION]: Think deeply before translating.";
                effortParam = "high";
                break;
            case 'medium':
            default:
                effortParam = "medium";
                break;
        }

        const payload = {
            model: aiModel || "gpt-3.5-turbo",
            messages:[
                { 
                    role: "system", 
                    content: `You are an expert anime subtitle translator. Translate the values of the JSON object into ${secondLang}. 
CRITICAL RULES:
1. Output ONLY a valid JSON object matching the exact keys (0, 1, 2...) of the input.
2. DO NOT merge sentences. Keep a strict 1-to-1 mapping for every key.
3. DO NOT output markdown formatting or \`\`\`json.
4. NO conversational text before or after the JSON.${effortPrompt}` 
                },
                { role: "user", content: JSON.stringify(linesObj) }
            ],
            temperature: 0.1 
        };
        
        if (aiModel && (aiModel.includes('o1') || aiModel.includes('o3'))) {
            payload.reasoning_effort = effortParam;
        }

        const headers = { 
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://www.crunchyroll.com', 
            'X-Title': 'CR Dual Subs Plugin'
        };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // ====================================================
        // ✨ 大模型 API 自动重试循环
        // ====================================================
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
                
                if (!res.ok) {
                    const errorText = await res.text();
                    const status = res.status;
                    
                    // 致命错误，直接熔断（Key 错误、接口地址错误、余额不足等）
                    if (status === 401 || status === 403 || status === 404 || status === 402) {
                        throw new Error(`致命错误 HTTP ${status}: ${errorText.substring(0, 40)}`);
                    }
                    
                    // 非致命错误（429 限流、500/502 服务器崩溃），抛出异常交给重试机制
                    throw new Error(`HTTP ${status}: ${errorText.substring(0, 40)}`);
                }
                
                const data = await res.json();
                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error("接口返回数据格式异常，缺少 choices[0].message");
                }

                let content = data.choices[0].message.content.trim();
                content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                let translatedArray = new Array(lines.length).fill("[翻译缺失]");
                
                const first = content.indexOf('{');
                const last = content.lastIndexOf('}');
                
                if (first !== -1 && last !== -1 && last > first) {
                    try {
                        const parsedObj = JSON.parse(content.substring(first, last + 1));
                        for (let i = 0; i < lines.length; i++) {
                            const translatedLine = parsedObj[i] || parsedObj[String(i)];
                            if (translatedLine) {
                                translatedArray[i] = translatedLine;
                            }
                        }
                        // 成功解析！直接返回结果，跳出重试循环
                        return translatedArray; 
                    } catch(e) {
                        throw new Error(`JSON 提取失败: 无法解析模型返回的文本`);
                    }
                } else {
                    throw new Error("大模型未返回包含 { } 的有效 JSON 字典");
                }

            } catch (e) {
                lastError = e;
                // 如果是致命错误，停止重试
                if (e.message.includes('致命错误')) throw e; 
                
                // 如果已经达到最大重试次数，抛出最终错误
                if (attempt === MAX_RETRIES) break;

                // 计算退避延迟 (Exponential Backoff)，如果是 429 错误则惩罚时间翻倍
                let delay = 1000 * attempt; 
                if (e.message.includes('429')) delay = 2500 * attempt;
                
                console.warn(`[CR双语插件] 大模型请求失败，等待 ${delay}ms 后进行第 ${attempt + 1}/${MAX_RETRIES} 次重试... 报错信息:`, e.message);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        
        throw new Error(`重试 ${MAX_RETRIES} 次后彻底失败: ${lastError.message}`);

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
                
                while (translatedArray.length < lines.length) translatedArray.push("[翻译缺失]");
                return translatedArray.slice(0, lines.length);

            } catch (e) {
                lastError = e;
                if (attempt === MAX_RETRIES) break;
                
                let delay = 1500 * attempt;
                if (e.message.includes('429')) delay = 3000 * attempt; // Google 429 惩罚期更长
                
                console.warn(`[CR双语插件] Google翻译失败，等待 ${delay}ms 后进行第 ${attempt + 1}/${MAX_RETRIES} 次重试...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        
        throw new Error(`Google 机翻重试 ${MAX_RETRIES} 次后失败: ${lastError.message}`);
    }
}