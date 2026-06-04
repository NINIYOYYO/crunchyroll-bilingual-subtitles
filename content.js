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
    reasoningEffort: "medium"
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
async function fetchAIBatchTranslation(linesArray, settings) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
            action: "translate_batch", 
            lines: linesArray, 
            settings: settings 
        }, (response) => {
            if (chrome.runtime.lastError) {
                consecutiveErrors++;
                resolve(linesArray.map(() => chrome.i18n.getMessage("toast_connection_lost")));
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
                showToast(chrome.i18n.getMessage("toast_api_error"), true);
                resolve(linesArray.map(() => chrome.i18n.getMessage("toast_translation_missing")));
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
        <div id="cr-inplayer-btn">${chrome.i18n.getMessage("style_adjust_btn") || "⚙️ Style Settings"}</div>
        <div id="cr-inplayer-panel">
            <div class="cr-panel-row">
                <label>${chrome.i18n.getMessage("font_size_label") || "Font Size"} <span id="cr-val-size">${settings.subSize}px</span></label>
                <input type="range" id="cr-range-size" min="14" max="50" value="${settings.subSize}">
            </div>
            <div class="cr-panel-row">
                <label>${chrome.i18n.getMessage("vertical_pos_label") || "Vertical Position"} <span id="cr-val-bottom">${settings.subBottom}%</span></label>
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
    
    const inFlight = new Set();
    const BATCH_SIZE = settings.batchSize || 10;
    const MAX_CONCURRENCY = settings.concurrency || 3;
    let isPreloading = false;

    const runContinuousPreload = async () => {
        if (!useAI || isPreloading) return;
        isPreloading = true;

        while (consecutiveErrors <= 3) {
            const v = document.querySelector('video');
            if (!v) break;
            const actualTime = v.currentTime;

            const currentIndex = parsedSubs.findIndex(sub => sub.end >= actualTime);
            if (currentIndex === -1) break; 

            const futureSubs = parsedSubs.slice(currentIndex);
            const uncachedLines =[...new Set(
                futureSubs.map(s => s.text.trim()).filter(t => t && !translationCache[t] && !inFlight.has(t))
            )];

            if (uncachedLines.length === 0) break;

            const targetLines = uncachedLines.slice(0, BATCH_SIZE * MAX_CONCURRENCY);
            const chunks =[];
            for (let i = 0; i < targetLines.length; i += BATCH_SIZE) {
                chunks.push(targetLines.slice(i, i + BATCH_SIZE));
            }

            const promises = chunks.map(chunk => {
                chunk.forEach(t => inFlight.add(t));
                return fetchAIBatchTranslation(chunk, settings).finally(() => {
                    chunk.forEach(t => inFlight.delete(t));
                });
            });

            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 1000));
        }
        
        isPreloading = false;
    };
    
    video._dualSubListener = async () => {
        if (settings.secondLang === "none") return;
        const currentTime = video.currentTime;
        
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
                            textElement.innerHTML = `<span style="color:#aaa;font-size:16px;">${chrome.i18n.getMessage('toast_ai_translating')}</span>`;
                            textElement.style.setProperty('display', 'inline-block', 'important');
                            return; 
                        }

                        if (pendingEmergencyFetch) return;
                        pendingEmergencyFetch = true;
                        
                        textElement.innerHTML = `<span style="color:#aaa;font-size:16px;">${chrome.i18n.getMessage('toast_fetching')}</span>`;
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
