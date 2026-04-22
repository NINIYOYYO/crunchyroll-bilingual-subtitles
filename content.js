// ==========================================
// Crunchyroll AI 双语字幕 Pro - content.js
// 包含【全自动静默推土机】后台预加载引擎
// ==========================================

const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_SETTINGS = {
    secondLang: "zh-CN", 
    transMode: "fallback", 
    transEngine: "custom_llm",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions", 
    aiModel: "nemotron-3-super-120b-a12b:free", 
    apiKey: "",
    subSize: 26, 
    subBottom: 10, 
    batchSize: 10, 
    concurrency: 3,
    reasoningEffort: "medium"
};

const translationCache = {};

// 1. 注入拦截脚本
(function injectOnce() {
    if (window.__CR_DUAL_SUBS_INJECTED__) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
    window.__CR_DUAL_SUBS_INJECTED__ = true;
})();

window.addEventListener("CR_SUBTITLE_DATA", (event) => {
    if (!event.detail) return;
    let detail;
    try { detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail; } catch (e) { return; }
    if (detail && !detail.url && !detail.data) detail = { url: "", options: {}, data: { subtitles: detail } };

    chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
        if (settings.secondLang !== "none") initDualSubs(detail, settings);
        else removeExistingSubtitles();
    });
});

function showToast(message, isError = true) {
    let toast = document.getElementById('cr-dual-sub-toast');
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.id = 'cr-dual-sub-toast';
    toast.style.cssText = `position:absolute; top:20px; left:20px; background:${isError ? 'rgba(220, 53, 69, 0.9)' : 'rgba(40, 167, 69, 0.9)'}; color:white; padding:10px 15px; border-radius:6px; z-index:99999; font-weight:bold; font-family:sans-serif; pointer-events:none; box-shadow:0 4px 6px rgba(0,0,0,0.3);`;
    toast.innerText = message;
    const container = document.querySelector('.bitmovinplayer-container') || document.body;
    container.appendChild(toast);
    setTimeout(() => { if (toast) toast.remove(); }, 6000);
}

function findTrackInManifest(data, lang, preferCaptions = false) {
    const fuzzyLang = lang.split('-')[0]; 
    const checkSubtitles = () => {
        if (data.subtitles) {
            if (data.subtitles[lang]) return { url: data.subtitles[lang].url, format: data.subtitles[lang].format || 'ass' };
            const subKey = Object.keys(data.subtitles).find(k => k.startsWith(fuzzyLang));
            if (subKey) return { url: data.subtitles[subKey].url, format: data.subtitles[subKey].format || 'ass' };
        }
        return null;
    };
    const checkCaptions = () => {
        if (data.captions) {
            if (data.captions[lang]) return { url: data.captions[lang].url, format: data.captions[lang].format || 'vtt' };
            const capKey = Object.keys(data.captions).find(k => k.startsWith(fuzzyLang));
            if (capKey) return { url: data.captions[capKey].url, format: data.captions[capKey].format || 'vtt' };
        }
        return null;
    };
    return preferCaptions ? (checkCaptions() || checkSubtitles()) : (checkSubtitles() || checkCaptions());
}

async function initDualSubs(detail, settings) {
    const { secondLang: targetLang, transMode } = settings;
    const { url, options, data } = detail;
    let targetTrack = null;
    let useAI = false;

    const findNativeCrossTrack = async (lang, preferCaptions = false) => {
        const versions = data.versions ||[];
        const originalVersion = versions.find(v => v.original === true) || versions.find(v => v.audio_locale === 'ja-JP');
        if (!originalVersion || !originalVersion.guid || !url) return null;
        
        const newUrl = url.replace(/\/v3\/[^\/]+\//, `/v3/${originalVersion.guid}/`);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            const res = await fetch(newUrl, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            const originalData = await res.json();
            
            if (originalData.assetId && originalData.token) {
                const deleteUrl = `https://www.crunchyroll.com/playback/v1/token/${originalData.assetId}/${originalData.token}`;
                fetch(deleteUrl, { method: 'DELETE', headers: options.headers || {} }).catch(()=>{});
            }
            return findTrackInManifest(originalData, lang, preferCaptions);
        } catch (e) { return null; }
    };

    if (transMode === 'force_ai') useAI = true;
    else {
        targetTrack = findTrackInManifest(data, targetLang, false);
        if (!targetTrack) targetTrack = await findNativeCrossTrack(targetLang, false);
    }

    if (!targetTrack && (transMode === 'fallback' || transMode === 'force_ai')) {
        useAI = true;
        targetTrack = findTrackInManifest(data, 'en-US', true); 
        if (!targetTrack) targetTrack = await findNativeCrossTrack('en-US', true);
    }

    if (!targetTrack) {
        showToast(transMode === 'native' ? `未找到官方字幕，AI降级已禁用。` : `解析失败！无官方字幕，也无底本供翻译。`);
        return;
    }

    try {
        const response = await fetch(targetTrack.url);
        const subText = await response.text();
        let parsedSubs = targetTrack.format === 'vtt' ? parseVTT(subText) : parseASS(subText);
        if (parsedSubs.length === 0) return showToast(`未解析出对白！`, true);
        renderSubtitlesOnVideo(parsedSubs, useAI, settings);
        showToast(`成功加载[${useAI ? 'AI推土机翻译引擎' : '官方跨轨'}]！`, false);
    } catch (e) { showToast(`字幕文件下载失败。`); }
}

let consecutiveErrors = 0;
async function fetchAIBatchTranslation(linesArray, settings) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
            action: "translate_batch", 
            lines: linesArray, 
            settings: settings 
        }, (response) => {
            if (chrome.runtime.lastError) {
                consecutiveErrors++;
                resolve(linesArray.map(() => `[通信断开]`));
                return;
            }
            if (response && response.success) {
                consecutiveErrors = 0;
                response.data.forEach((translated, index) => {
                    translationCache[linesArray[index]] = translated;
                });
                resolve(response.data);
            } else {
                consecutiveErrors++;
                showToast(`批量API报错: ${response?.error}`, true);
                resolve(linesArray.map(() => `[API报错]`));
            }
        });
    });
}

function parseVTT(vttText) {
    const lines = vttText.split(/\r?\n/); const result =[]; let i = 0;
    const timeToSeconds = (timeStr) => {
        const parts = timeStr.trim().split(':'); let secs = 0;
        if (parts.length === 3) secs = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
        else if (parts.length === 2) secs = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
        return secs;
    };
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.includes('-->')) {
            const times = line.split('-->');
            const start = timeToSeconds(times[0]); const end = timeToSeconds(times[1].trim().split(' ')[0]); 
            let text = ""; i++;
            while (i < lines.length && lines[i].trim() !== '') {
                let cleanLine = lines[i].replace(/<[^>]+>/g, '').trim();
                if (cleanLine) text += (text ? '\n' : '') + cleanLine;
                i++;
            }
            if (text) result.push({ start, end, text });
        } else i++;
    }
    return result;
}

function parseASS(assText) {
    const lines = assText.split(/\r?\n/); const result =[];
    const timeToSeconds = (timeStr) => {
        if (!timeStr) return 0; const parts = timeStr.split(':');
        return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
    };
    for (const line of lines) {
        if (!line.startsWith('Dialogue:')) continue;
        const parts = line.split(','); if (parts.length < 10) continue;
        const cleanText = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').trim();
        if (cleanText) result.push({ start: timeToSeconds(parts[1]), end: timeToSeconds(parts[2]), text: cleanText });
    }
    return result;
}

function renderSubtitlesOnVideo(parsedSubs, useAI, settings) {
    const intervalId = setInterval(() => {
        const video = document.querySelector('video');
        const playerContainer = document.querySelector('.bitmovinplayer-container') || document.getElementById('player-container');
        if (video && playerContainer) {
            clearInterval(intervalId);
            setupContainerAndListen(video, playerContainer, parsedSubs, useAI, settings);
            setupInPlayerControls(playerContainer, settings); 
        }
    }, 1000);
}

function setupInPlayerControls(playerContainer, settings) {
    if (document.getElementById('cr-inplayer-controls-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'cr-inplayer-controls-wrapper';
    wrapper.innerHTML = `
        <div id="cr-inplayer-btn">⚙️ 样式调节</div>
        <div id="cr-inplayer-panel">
            <div class="cr-panel-row">
                <label>字体大小 <span id="cr-val-size">${settings.subSize}px</span></label>
                <input type="range" id="cr-range-size" min="14" max="50" value="${settings.subSize}">
            </div>
            <div class="cr-panel-row">
                <label>垂直位置 <span id="cr-val-bottom">${settings.subBottom}%</span></label>
                <input type="range" id="cr-range-bottom" min="0" max="80" value="${settings.subBottom}">
            </div>
        </div>
    `;
    playerContainer.appendChild(wrapper);

    const btn = document.getElementById('cr-inplayer-btn');
    const panel = document.getElementById('cr-inplayer-panel');
    const rangeSize = document.getElementById('cr-range-size');
    const rangeBottom = document.getElementById('cr-range-bottom');
    const valSize = document.getElementById('cr-val-size');
    const valBottom = document.getElementById('cr-val-bottom');
    const subContainer = document.getElementById('my-cr-dual-sub-container');
    const subText = document.getElementById('my-cr-dual-sub-text');

    if (subContainer) subContainer.style.setProperty('--cr-sub-bottom', `${settings.subBottom}%`);
    if (subText) subText.style.setProperty('--cr-sub-size', `${settings.subSize}px`);

    btn.addEventListener('click', () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; });

    rangeSize.addEventListener('input', (e) => {
        const v = e.target.value;
        valSize.innerText = `${v}px`;
        if (subText) subText.style.setProperty('--cr-sub-size', `${v}px`);
        chrome.storage.local.set({ subSize: v });
    });

    rangeBottom.addEventListener('input', (e) => {
        const v = e.target.value;
        valBottom.innerText = `${v}%`;
        if (subContainer) subContainer.style.setProperty('--cr-sub-bottom', `${v}%`);
        chrome.storage.local.set({ subBottom: v });
    });
}

// =================================================================
// ✨ 全自动后台静默预加载推土机引擎 (Continuous Preloader)
// =================================================================
function setupContainerAndListen(video, playerContainer, parsedSubs, useAI, settings) {
    let subContainer = document.getElementById('my-cr-dual-sub-container');
    if (!subContainer) {
        subContainer = document.createElement('div');
        subContainer.id = 'my-cr-dual-sub-container';
        playerContainer.appendChild(subContainer);
    }

    let textElement = document.getElementById('my-cr-dual-sub-text');
    if (!textElement) {
        textElement = document.createElement('div');
        textElement.id = 'my-cr-dual-sub-text';
        subContainer.appendChild(textElement);
    }

    textElement.style.color = useAI ? (settings.transEngine === 'custom_llm' ? '#00FFFF' : '#55FF55') : '#FFFF00';

    if (video._dualSubListener) video.removeEventListener('timeupdate', video._dualSubListener);

    let currentDisplayedSourceText = "";
    let pendingEmergencyFetch = false;
    
    // ---------------- 后台队列管家 ----------------
    let activeRequests = 0;
    const inFlight = new Set();
    const BATCH_SIZE = settings.batchSize || 10;
    const MAX_CONCURRENCY = settings.concurrency || 3;
    let isPreloading = false;

    // ✨ 死循环推土机函数
    const runContinuousPreload = async () => {
        if (!useAI || isPreloading) return;
        isPreloading = true;

        while (consecutiveErrors <= 3) {
            // 每次循环重新获取真正的 currentTime，因为视频一直在走
            const v = document.querySelector('video');
            if (!v) break;
            const actualTime = v.currentTime;

            // 寻找当前进度往后的所有对白
            const currentIndex = parsedSubs.findIndex(sub => sub.end >= actualTime);
            if (currentIndex === -1) break; // 视频放完了

            const futureSubs = parsedSubs.slice(currentIndex);
            
            // 过滤出“没被翻译过”且“不在请求中”的对白
            const uncachedLines =[...new Set(
                futureSubs.map(s => s.text.trim()).filter(t => t && !translationCache[t] && !inFlight.has(t))
            )];

            // 如果未来已经没有未翻译的对白了，推土机就去睡觉
            if (uncachedLines.length === 0) break;

            // 掐出并发队列允许的句子数量 (如 3 * 10 = 30 句)
            const targetLines = uncachedLines.slice(0, BATCH_SIZE * MAX_CONCURRENCY);
            const chunks =[];
            for (let i = 0; i < targetLines.length; i += BATCH_SIZE) {
                chunks.push(targetLines.slice(i, i + BATCH_SIZE));
            }

            // 发起并发请求
            const promises = chunks.map(chunk => {
                chunk.forEach(t => inFlight.add(t));
                return fetchAIBatchTranslation(chunk, settings).finally(() => {
                    chunk.forEach(t => inFlight.delete(t));
                });
            });

            // 只有当这一批 (30句话) 翻译完存入缓存后，才进入下一次循环去翻译第 31~60 句话！
            await Promise.all(promises);

            // 温柔对待 API，每一大批次翻译完休息 1 秒
            await new Promise(r => setTimeout(r, 1000));
        }
        
        isPreloading = false;
    };
    
    // ---------------- 视频更新监听器 ----------------
    video._dualSubListener = async () => {
        if (settings.secondLang === "none") return;
        const currentTime = video.currentTime;
        
        // ✨ 只要触发了播放，就唤醒推土机去后台干活
        if (useAI) runContinuousPreload();

        const activeSubs = parsedSubs.filter(sub => currentTime >= sub.start && currentTime <= sub.end);

        if (activeSubs.length > 0) {
            const lines = activeSubs.map(s => s.text);
            const combinedSourceText = lines.join('\n');

            if (currentDisplayedSourceText !== combinedSourceText) {
                currentDisplayedSourceText = combinedSourceText;

                if (useAI) {
                    const allCached = lines.every(line => translationCache[line]);

                    if (!allCached) {
                        const isBeingPreloaded = lines.some(line => inFlight.has(line));
                        
                        if (isBeingPreloaded) {
                            textElement.innerHTML = `<span style="color:#aaa;font-size:16px;">[AI翻译生成中...]</span>`;
                            textElement.style.setProperty('display', 'inline-block', 'important');
                            return; 
                        }

                        // 如果用户跳转了进度条到推土机还没来得及推的地方，触发紧急抓取
                        if (pendingEmergencyFetch) return;
                        pendingEmergencyFetch = true;
                        
                        textElement.innerHTML = `<span style="color:#aaa;font-size:16px;">[获取新区域翻译...]</span>`;
                        textElement.style.setProperty('display', 'inline-block', 'important'); 
                        
                        try {
                            const currentIndex = parsedSubs.findIndex(sub => sub.end >= currentTime);
                            const contextSubs = parsedSubs.slice(currentIndex, currentIndex + BATCH_SIZE);
                            const contextLines =[...new Set(contextSubs.map(s => s.text.trim()).filter(t => t && !translationCache[t] && !inFlight.has(t)))];
                            
                            if (contextLines.length > 0) {
                                contextLines.forEach(t => inFlight.add(t));
                                await fetchAIBatchTranslation(contextLines, settings);
                                contextLines.forEach(t => inFlight.delete(t));
                            }

                            if (currentDisplayedSourceText === combinedSourceText) {
                                const displayTranslated = lines.map(line => translationCache[line] || line);
                                textElement.innerHTML = displayTranslated.join('<br>');
                            }
                        } finally {
                            pendingEmergencyFetch = false;
                        }
                    } else {
                        // 命中缓存，零延迟开显示
                        const translatedLines = lines.map(line => translationCache[line]);
                        textElement.innerHTML = translatedLines.join('<br>');
                        textElement.style.setProperty('display', 'inline-block', 'important');
                    }
                } else {
                    textElement.innerHTML = combinedSourceText.replace(/\n/g, '<br>');
                    textElement.style.setProperty('display', 'inline-block', 'important');
                }
            }
        } else {
            if (currentDisplayedSourceText !== "") {
                currentDisplayedSourceText = "";
                pendingEmergencyFetch = false;
                textElement.style.setProperty('display', 'none', 'important');
                textElement.innerHTML = '';
            }
        }
    };
    video.addEventListener('timeupdate', video._dualSubListener);
}

function removeExistingSubtitles() {
    const c = document.getElementById('my-cr-dual-sub-container');
    const w = document.getElementById('cr-inplayer-controls-wrapper');
    const t = document.getElementById('cr-dual-sub-toast');
    if (c) c.remove();
    if (w) w.remove();
    if (t) t.remove();
}