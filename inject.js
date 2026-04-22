// inject.js
// Network interceptor for Crunchyroll subtitle API
(function() {
    if (window.__CR_DUAL_SUBS_INJECTED__) return;
    window.__CR_DUAL_SUBS_INJECTED__ = true;

    console.log("[CR双语插件] 网络拦截器已挂载");

    const originalFetch = window.fetch;
    const retryBackoffs = {};

    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();

        let reqUrl = '';
        let reqOptions = {};
        if (typeof args[0] === 'string') {
            reqUrl = args[0];
            reqOptions = args[1] || {};
        } else if (args[0] && args[0].url) {
            reqUrl = args[0].url;
            reqOptions = args[1] || {};
        }

        // 核心修复：只提取纯净的 Headers，丢弃 AbortSignal 等导致通信失败的复杂对象
        let safeHeaders = {};
        if (reqOptions.headers) {
            try {
                if (typeof reqOptions.headers.forEach === 'function') {
                    reqOptions.headers.forEach((val, key) => {
                        if (key && val) safeHeaders[key] = val;
                    });
                } else if (reqOptions.headers instanceof Object) {
                    safeHeaders = JSON.parse(JSON.stringify(reqOptions.headers));
                }
            } catch (e) {
                console.debug("[CR双语插件] 解析请求头失败", e);
            }
        }

        if (reqUrl && reqUrl.includes('/playback/v3/') && reqUrl.includes('/play')) {
            const retryKey = reqUrl;
            const backoff = getBackoff(retryKey);

            clone.json().then(data => {
                if (data && data.subtitles) {
                    // 核心修复：将整个数据序列化为纯字符串，彻底绕过浏览器的克隆限制
                    const payload = JSON.stringify({
                        url: reqUrl,
                        options: { headers: safeHeaders },
                        data: data
                    });
                    window.dispatchEvent(new CustomEvent("CR_SUBTITLE_DATA", { detail: payload }));
                    // 成功，重置退避
                    delete retryBackoffs[retryKey];
                }
            }).catch(e => {
                // 解析失败忽略，但记录退避
                updateBackoff(retryKey);
            });
        }

        return response;
    };

    // 指数退避策略：500ms -> 1s -> 2s -> 4s (max)
    function getBackoff(key) {
        return retryBackoffs[key] || 500;
    }

    function updateBackoff(key) {
        const current = retryBackoffs[key] || 500;
        retryBackoffs[key] = Math.min(current * 2, 4000);
    }
})();