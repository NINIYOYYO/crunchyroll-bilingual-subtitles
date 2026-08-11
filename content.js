// ==========================================
// Crunchyroll AI Bilingual Subtitles Pro - content.js
// 包含【防抢占延迟引擎】修复首播崩溃问题
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
    reasoningEnabled: true,
    streaming: true,
    autoRepairEnabled: true,
    subColor: "",
    subBgOpacity: 65,
    subTop: "auto",
    subLeft: "0",
    subWidth: "100%"
};

const translationCache = {};

(function injectOnce() {
    if (window.__CR_DUAL_SUBS_INJECTED__) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
    window.__CR_DUAL_SUBS_INJECTED__ = true;
})();

let lastProcessedUrl = '';
window.addEventListener("CR_SUBTITLE_DATA", (event) => {
    if (!event.detail) return;
    let detail;
    try { detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail; } catch (e) { return; }
    if (detail && !detail.url && !detail.data) detail = { url: "", options: {}, data: { subtitles: detail } };

    if (detail.url && detail.url === lastProcessedUrl) return;
    lastProcessedUrl = detail.url;

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
            if (data.subtitles[lang] && data.subtitles[lang].url) return { url: data.subtitles[lang].url, format: data.subtitles[lang].format || 'ass' };
            const subKey = Object.keys(data.subtitles).find(k => k.startsWith(fuzzyLang) && data.subtitles[k].url);
            if (subKey) return { url: data.subtitles[subKey].url, format: data.subtitles[subKey].format || 'ass' };
        }
        return null;
    };
    const checkCaptions = () => {
        if (data.captions) {
            if (data.captions[lang] && data.captions[lang].url) return { url: data.captions[lang].url, format: data.captions[lang].format || 'vtt' };
            const capKey = Object.keys(data.captions).find(k => k.startsWith(fuzzyLang) && data.captions[k].url);
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
    let hasWaitedForCrossTrack = false; // ✨ 记录是否已经为防抢占做过延迟

    const findCrossTrack = async (lang, preferCaptions = false, targetAudioLocale = null) => {
        const versions = data.versions ||[];
        let targetVersion = null;
        
        if (targetAudioLocale === 'original') {
            targetVersion = versions.find(v => v.original === true);
        } else if (targetAudioLocale) {
            targetVersion = versions.find(v => v.audio_locale === targetAudioLocale);
        }
        
        if (!targetVersion) {
            targetVersion = versions.find(v => v.original === true) || versions.find(v => v.audio_locale === 'ja-JP');
        }
        if (!targetVersion || !targetVersion.guid || !url) return null;
        
        const currentGuidMatch = url.match(/\/v3\/([^\/]+)\//);
        if (currentGuidMatch && currentGuidMatch[1] === targetVersion.guid) {
            return findTrackInManifest(data, lang, preferCaptions);
        }

        // ✨ 核心修复：防抢占竞态！如果是首次执行跨轨，强制休眠 2.5 秒，让主视频先稳定加载画面和 Token，避免被顶号
        if (!hasWaitedForCrossTrack) {
            hasWaitedForCrossTrack = true;
            await new Promise(r => setTimeout(r, 2500));
        }

        const newUrl = url.replace(/\/v3\/[^\/]+\//, `/v3/${targetVersion.guid}/`);
        const fetchUrl = newUrl.includes('?') ? newUrl + '&cr_cross_track=1' : newUrl + '?cr_cross_track=1';
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            const safeHeaders = new Headers(options.headers || {});
            
            const res = await fetch(fetchUrl, { headers: safeHeaders, signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) return null; 
            
            const originalData = await res.json();

            // 阅后即焚，销毁并发后台 Token
            if (originalData.assetId && originalData.token) {
                const deleteUrl = `https://www.crunchyroll.com/playback/v1/token/${originalData.assetId}/${originalData.token}`;
                fetch(deleteUrl, { method: 'DELETE', headers: safeHeaders }).catch(()=>{});
            }

            return findTrackInManifest(originalData, lang, preferCaptions);
        } catch (e) { return null; }
    };

    if (transMode !== 'force_ai') {
        targetTrack = findTrackInManifest(data, targetLang, false);
        if (!targetTrack) targetTrack = await findCrossTrack(targetLang, false, 'original'); 
        if (!targetTrack) targetTrack = await findCrossTrack(targetLang, false, 'ja-JP');
    }

    if (!targetTrack && (transMode === 'fallback' || transMode === 'force_ai')) {
        useAI = true;
        targetTrack = findTrackInManifest(data, 'en-US', true); 

        if (!targetTrack) targetTrack = await findCrossTrack('en-US', true, 'en-US'); 
        if (!targetTrack) targetTrack = await findCrossTrack('en-US', true, 'original'); 
        if (!targetTrack) targetTrack = await findCrossTrack('en-US', true, 'ja-JP'); 
    }

    if (!targetTrack) {
        showToast(transMode === 'native' ? chrome.i18n.getMessage("toast_no_official_subs") : chrome.i18n.getMessage("toast_parse_failed"));
        return;
    }

    try {
        const response = await fetch(targetTrack.url);
        const subText = await response.text();
        let parsedSubs = targetTrack.format === 'vtt' ? parseVTT(subText) : parseASS(subText);
        if (parsedSubs.length === 0) return showToast(chrome.i18n.getMessage("toast_no_dialogue"), true);
        renderSubtitlesOnVideo(parsedSubs, useAI, settings);
        showToast(chrome.i18n.getMessage("toast_loaded"), false);
    } catch (e) { showToast(chrome.i18n.getMessage("toast_download_failed")); }
}

let consecutiveErrors = 0;
let lastErrorTime = 0;

/**
 * 发送批量 AI 翻译请求，带有连接失败与状态异常捕获。
 *
 * @param {Array<string>} linesArray - 原文台词数组。
 * @param {Object} settings - 扩展用户配置。
 * @returns {Promise<Array<string>>} 包含译文的 Promise 数组。
 */
async function fetchAIBatchTranslation(linesArray, settings) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
            action: "translate_batch", 
            lines: linesArray, 
            settings: settings 
        }, (response) => {
            if (chrome.runtime.lastError) {
                consecutiveErrors++;
                lastErrorTime = Date.now();
                resolve(linesArray.map(line => line)); // 失败时回退为原文，保证连续性
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
                lastErrorTime = Date.now();
                showToast(chrome.i18n.getMessage("toast_api_error"), true);
                resolve(linesArray.map(line => line)); // 失败时回退为原文
            }
        });
    });
}

// ✨ 流式通道：打开长连接到 background，实时接收逐行(partial)与最终(done)翻译
// onPartial(translationsMap) / onDone(data, success, error)
function openTranslationStream(linesArray, settings, callbacks) {
    const { onPartial, onDone } = callbacks;
    const port = chrome.runtime.connect({ name: 'translate_stream' });
    let settled = false;
    const finish = (data, success, error) => {
        if (settled) return;
        settled = true;
        try { port.disconnect(); } catch (e) {}
        if (onDone) onDone(data, success, error);
    };
    port.onMessage.addListener((msg) => {
        if (!msg) return;
        if (msg.type === 'partial') {
            if (onPartial) onPartial(msg.translations || {});
        } else if (msg.type === 'done') {
            finish(msg.translations, msg.success, msg.error);
        }
    });
    port.onDisconnect.addListener(() => finish(null, false, "stream disconnected"));
    port.postMessage({ action: 'translate_stream', lines: linesArray, settings });
    return port;
}

function parseVTT(vttText) {
    const lines = vttText.split(/\r?\n/); const result =[]; let i = 0; let cueCounter = 0;
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
            if (text) result.push({ cueId: cueCounter++, start, end, text });
        } else i++;
    }
    return result;
}

function parseASS(assText) {
    const lines = assText.split(/\r?\n/); const result =[]; let cueCounter = 0;
    const timeToSeconds = (timeStr) => {
        if (!timeStr) return 0; const parts = timeStr.split(':');
        return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
    };
    for (const line of lines) {
        if (!line.startsWith('Dialogue:')) continue;
        const parts = line.split(','); if (parts.length < 10) continue;
        const cleanText = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/g, '\n').trim();
        if (cleanText) result.push({ cueId: cueCounter++, start: timeToSeconds(parts[1]), end: timeToSeconds(parts[2]), text: cleanText });
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
        <div id="cr-inplayer-btn">${chrome.i18n.getMessage("style_adjust_btn") || "⚙️ Style Settings"}</div>
        <div id="cr-inplayer-panel">
            <div class="cr-panel-row">
                <label>${chrome.i18n.getMessage("font_size_label") || "Font Size"} <span id="cr-val-size">${settings.subSize}px</span></label>
                <input type="range" id="cr-range-size" min="14" max="50" value="${settings.subSize}">
            </div>
            <div class="cr-panel-row">
                <label>${chrome.i18n.getMessage("vertical_pos_label") || "Vertical Position"} <span id="cr-val-bottom">${settings.subBottom}%</span></label>
                <input type="range" id="cr-range-bottom" min="0" max="100" value="${settings.subBottom}">
            </div>
            <div class="cr-panel-row" style="display:flex; justify-content:space-between; align-items:center;">
                <label style="margin:0; font-size:13px; color:#ccc;">${chrome.i18n.getMessage("font_color_label") || "Font Color"}</label>
                <input type="color" id="cr-color-picker" value="${settings.subColor || '#ffffff'}">
            </div>
            <div class="cr-panel-row">
                <label>${chrome.i18n.getMessage("bg_opacity_label") || "Background Opacity"} <span id="cr-val-opacity">${settings.subBgOpacity}%</span></label>
                <input type="range" id="cr-range-opacity" min="0" max="100" value="${settings.subBgOpacity}">
            </div>
            <div class="cr-panel-row">
                <button id="cr-reset-pos" style="width:100%; padding:6px; background:#f47521; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">${chrome.i18n.getMessage("reset_style_btn") || "Reset Style & Pos"}</button>
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
    const colorPicker = document.getElementById('cr-color-picker');
    const rangeOpacity = document.getElementById('cr-range-opacity');
    const valOpacity = document.getElementById('cr-val-opacity');
    const resetBtn = document.getElementById('cr-reset-pos');
    
    const subContainer = document.getElementById('my-cr-dual-sub-container');
    const subText = document.getElementById('my-cr-dual-sub-text');

    if (subContainer) {
        subContainer.style.setProperty('--cr-sub-bottom', settings.subBottom !== 'auto' ? `${settings.subBottom}%` : 'auto');
        subContainer.style.setProperty('--cr-sub-top', settings.subTop);
        subContainer.style.setProperty('--cr-sub-left', settings.subLeft);
        subContainer.style.setProperty('--cr-sub-width', settings.subWidth);
    }
    if (subText) {
        subText.style.setProperty('--cr-sub-size', `${settings.subSize}px`);
        if (settings.subColor) subText.style.setProperty('--cr-sub-color', settings.subColor);
        subText.style.setProperty('--cr-sub-bg', `rgba(0, 0, 0, ${settings.subBgOpacity / 100})`);
    }

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
        if (subContainer) {
            subContainer.style.setProperty('--cr-sub-bottom', `${v}%`);
            subContainer.style.setProperty('--cr-sub-top', 'auto');
            subContainer.style.setProperty('--cr-sub-left', '0');
            subContainer.style.setProperty('--cr-sub-width', '100%');
        }
        chrome.storage.local.set({ subBottom: v, subTop: 'auto', subLeft: '0', subWidth: '100%' });
    });

    colorPicker.addEventListener('input', (e) => {
        const v = e.target.value;
        if (subText) subText.style.setProperty('--cr-sub-color', v);
        chrome.storage.local.set({ subColor: v });
    });

    rangeOpacity.addEventListener('input', (e) => {
        const v = e.target.value;
        valOpacity.innerText = `${v}%`;
        if (subText) subText.style.setProperty('--cr-sub-bg', `rgba(0, 0, 0, ${v / 100})`);
        chrome.storage.local.set({ subBgOpacity: v });
    });

    resetBtn.addEventListener('click', () => {
        chrome.storage.local.set({
            subBottom: 10, subTop: 'auto', subLeft: '0', subWidth: '100%',
            subColor: "", subBgOpacity: 65, subSize: 26
        }, () => {
            rangeBottom.value = 10; valBottom.innerText = '10%';
            rangeSize.value = 26; valSize.innerText = '26px';
            rangeOpacity.value = 65; valOpacity.innerText = '65%';
            colorPicker.value = '#ffffff';
            if (subContainer) {
                subContainer.style.setProperty('--cr-sub-bottom', '10%');
                subContainer.style.setProperty('--cr-sub-top', 'auto');
                subContainer.style.setProperty('--cr-sub-left', '0');
                subContainer.style.setProperty('--cr-sub-width', '100%');
            }
            if (subText) {
                subText.style.setProperty('--cr-sub-size', '26px');
                subText.style.removeProperty('--cr-sub-color'); // Let it fallback to useAI logic
                subText.style.setProperty('--cr-sub-bg', `rgba(0, 0, 0, 0.65)`);
            }
        });
    });
}

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

    if (settings.subColor) {
        textElement.style.setProperty('--cr-sub-color', settings.subColor);
    } else {
        textElement.style.setProperty('--cr-sub-color', useAI ? (settings.transEngine === 'custom_llm' ? '#00FFFF' : '#55FF55') : '#FFFF00');
    }
    
    textElement.style.setProperty('--cr-sub-bg', `rgba(0, 0, 0, ${settings.subBgOpacity / 100})`);
    subContainer.style.setProperty('--cr-sub-top', settings.subTop);
    subContainer.style.setProperty('--cr-sub-left', settings.subLeft);
    subContainer.style.setProperty('--cr-sub-width', settings.subWidth);
    if (settings.subBottom !== 'auto') {
        subContainer.style.setProperty('--cr-sub-bottom', `${settings.subBottom}%`);
    } else {
        subContainer.style.setProperty('--cr-sub-bottom', 'auto');
    }

    makeDraggable(textElement, subContainer, playerContainer);

    if (video._dualSubListener) video.removeEventListener('timeupdate', video._dualSubListener);

    // ✨ 实时流式开关：仅 custom_llm 引擎支持逐字流式
    const streamingEnabled = useAI && settings.streaming && settings.transEngine === 'custom_llm';
    const streamingCache = {}; // source line -> 进行中的部分译文（实时显示用）

    let currentDisplayedSourceText = "";
    let currentActiveSubs = []; // 当前正在显示的 Cue 对象数组

    const inFlight = new Set();
    const BATCH_SIZE = settings.batchSize || 10;
    const MAX_CONCURRENCY = settings.concurrency || 3;
    let isPreloading = false;

    // ✨ 渲染当前正在显示的字幕行：根据 cueId 绝对锚定检索，彻底杜绝错位
    const renderActive = () => {
        if (!currentDisplayedSourceText) {
            textElement.style.setProperty('display', 'none', 'important');
            textElement.innerHTML = '';
            return;
        }
        const activeCues = currentActiveSubs;
        const fmt = (t) => t.replace(/\n/g, '<br>').replace(/\\n/g, '<br>');
        const parts = activeCues.map(sub => {
            const id = sub.cueId !== undefined ? sub.cueId : sub.text;
            if (translationCache[id]) return fmt(translationCache[id]);
            if (translationCache[sub.text]) return fmt(translationCache[sub.text]);
            const sp = streamingCache[id] || streamingCache[sub.text];
            if (sp != null) return fmt(sp) + '▌'; // 仍在生成中，加光标提示
            return `<span style="color:#888;font-size:16px;">…</span>`;
        });
        textElement.innerHTML = parts.join('<br>');
        textElement.style.setProperty('display', 'inline-block', 'important');
    };

    // ✨ 统一的批次请求：传递带绝对 cueId 的对象数组，流式/批量统一绑定
    function requestBatch(chunk) {
        chunk.forEach(item => {
            const key = item && item.id !== undefined ? item.id : item;
            inFlight.add(key);
        });

        if (streamingEnabled) {
            return new Promise((resolve) => {
                openTranslationStream(chunk, settings, {
                    onPartial: (tr) => {
                        const activeIds = currentActiveSubs.map(s => s.cueId !== undefined ? s.cueId : s.text);
                        let hitsActive = false;
                        Object.keys(tr).forEach(k => {
                            const parsedId = Number(k);
                            const item = chunk.find(c => (c && c.id === parsedId)) || chunk[parsedId];
                            if (item != null) {
                                const key = item.id !== undefined ? item.id : item;
                                streamingCache[key] = tr[k];
                                if (activeIds.includes(key)) hitsActive = true;
                            }
                        });
                        if (hitsActive) renderActive();
                    },
                    onDone: (data, success) => {
                        chunk.forEach(item => {
                            const key = item && item.id !== undefined ? item.id : item;
                            inFlight.delete(key);
                        });
                        if (success && data) {
                            consecutiveErrors = 0;
                            data.forEach((t, i) => {
                                const item = chunk[i];
                                if (item != null) {
                                    const key = item.id !== undefined ? item.id : item;
                                    translationCache[key] = t;
                                    if (item.text) translationCache[item.text] = t;
                                    delete streamingCache[key];
                                }
                            });
                        } else {
                            consecutiveErrors++;
                            lastErrorTime = Date.now();
                            showToast(chrome.i18n.getMessage("toast_api_error"), true);
                            chunk.forEach(item => {
                                const key = item && item.id !== undefined ? item.id : item;
                                delete streamingCache[key];
                            });
                        }
                        if (currentDisplayedSourceText) renderActive();
                        resolve(data);
                    }
                });
            });
        }

        return fetchAIBatchTranslation(chunk, settings).then(data => {
            data.forEach((t, i) => {
                const item = chunk[i];
                if (item != null) {
                    const key = item.id !== undefined ? item.id : item;
                    translationCache[key] = t;
                    if (item.text) translationCache[item.text] = t;
                }
            });
            chunk.forEach(item => {
                const key = item && item.id !== undefined ? item.id : item;
                inFlight.delete(key);
            });
            if (currentDisplayedSourceText) renderActive();
            return data;
        }).catch(() => {
            chunk.forEach(item => {
                const key = item && item.id !== undefined ? item.id : item;
                inFlight.delete(key);
            });
        });
    }

    /**
     * 连续预加载逻辑：按绝对 cueId 进行过滤预载。
     */
    const runContinuousPreload = async () => {
        if (!useAI || isPreloading) return;

        if (consecutiveErrors > 3) {
            if (Date.now() - lastErrorTime > 10000) {
                consecutiveErrors = 0;
            } else {
                return;
            }
        }

        isPreloading = true;

        while (consecutiveErrors <= 3) {
            const v = document.querySelector('video');
            if (!v) break;
            const actualTime = v.currentTime;

            const currentIndex = parsedSubs.findIndex(sub => sub.end >= actualTime);
            if (currentIndex === -1) break;

            const futureSubs = parsedSubs.slice(currentIndex);
            const uncachedCues = futureSubs.filter(s => {
                const key = s.cueId !== undefined ? s.cueId : s.text;
                return s.text && !translationCache[key] && !inFlight.has(key);
            });

            if (uncachedCues.length === 0) break;

            const targetCues = uncachedCues.slice(0, BATCH_SIZE * MAX_CONCURRENCY);
            const chunks = [];
            for (let i = 0; i < targetCues.length; i += BATCH_SIZE) {
                const batchItems = targetCues.slice(i, i + BATCH_SIZE).map(c => ({ id: c.cueId, text: c.text }));
                chunks.push(batchItems);
            }

            const promises = chunks.map(chunk => requestBatch(chunk));

            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 1000));
        }

        isPreloading = false;
    };

    video._dualSubListener = () => {
        if (settings.secondLang === "none") return;
        const currentTime = video.currentTime;

        if (useAI) runContinuousPreload();

        const activeSubs = parsedSubs.filter(sub => currentTime >= sub.start && currentTime <= sub.end);

        if (activeSubs.length > 0) {
            const lines = activeSubs.map(s => s.text);
            const combinedSourceText = lines.join('\n');

            if (currentDisplayedSourceText !== combinedSourceText) {
                currentDisplayedSourceText = combinedSourceText;
                currentActiveSubs = activeSubs;
                renderActive();

                const needTranslationCues = activeSubs.filter(s => {
                    const key = s.cueId !== undefined ? s.cueId : s.text;
                    return !translationCache[key] && !inFlight.has(key);
                });
                if (useAI && needTranslationCues.length > 0) {
                    const batchItems = needTranslationCues.map(c => ({ id: c.cueId, text: c.text }));
                    requestBatch(batchItems);
                }
            }
        } else {
            if (currentDisplayedSourceText !== "") {
                currentDisplayedSourceText = "";
                currentActiveSubs = [];
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

function makeDraggable(textEl, containerEl, videoContainer) {
    if (textEl._dragInitialized) return;
    textEl._dragInitialized = true;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    textEl.addEventListener('mousedown', (e) => {
        isDragging = true;
        
        const rect = containerEl.getBoundingClientRect();
        const parentRect = videoContainer.getBoundingClientRect();
        
        if (containerEl.style.getPropertyValue('--cr-sub-width') === '' || containerEl.style.getPropertyValue('--cr-sub-width') === '100%') {
            containerEl.style.setProperty('--cr-sub-width', 'auto');
            containerEl.style.setProperty('--cr-sub-bottom', 'auto');
            initialLeft = rect.left - parentRect.left;
            initialTop = rect.top - parentRect.top;
            containerEl.style.setProperty('--cr-sub-left', `${initialLeft}px`);
            containerEl.style.setProperty('--cr-sub-top', `${initialTop}px`);
        } else {
            initialLeft = parseFloat(containerEl.style.getPropertyValue('--cr-sub-left')) || (rect.left - parentRect.left);
            initialTop = parseFloat(containerEl.style.getPropertyValue('--cr-sub-top')) || (rect.top - parentRect.top);
        }

        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault(); 
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        const newLeft = initialLeft + dx;
        const newTop = initialTop + dy;
        
        containerEl.style.setProperty('--cr-sub-left', `${newLeft}px`);
        containerEl.style.setProperty('--cr-sub-top', `${newTop}px`);
    });

    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        const rect = containerEl.getBoundingClientRect();
        const parentRect = videoContainer.getBoundingClientRect();
        
        const leftPct = ((rect.left - parentRect.left) / parentRect.width) * 100;
        const topPct = ((rect.top - parentRect.top) / parentRect.height) * 100;
        
        containerEl.style.setProperty('--cr-sub-left', `${leftPct}%`);
        containerEl.style.setProperty('--cr-sub-top', `${topPct}%`);
        
        chrome.storage.local.set({
            subLeft: `${leftPct}%`,
            subTop: `${topPct}%`,
            subWidth: 'auto',
            subBottom: 'auto'
        });
    });
}
