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
        let reqHeaders = null;

        if (typeof args[0] === 'string') {
            reqUrl = args[0];
            reqOptions = args[1] || {};
            reqHeaders = reqOptions.headers;
        } else if (args[0] && typeof args[0] === 'object') {
            reqUrl = args[0].url || '';
            reqOptions = args[1] || {};
            reqHeaders = reqOptions.headers || args[0].headers;
        }

        // ✨ 核心修复：跳过插件内部发起的跨轨请求，彻底切断无限死循环！
        if (reqUrl.includes('cr_cross_track=1')) {
            return response;
        }

        let safeHeaders = {};
        if (reqHeaders) {
            try {
                if (typeof reqHeaders.forEach === 'function') {
                    reqHeaders.forEach((val, key) => {
                        if (key && val) safeHeaders[key] = val;
                    });
                } else if (reqHeaders instanceof Object) {
                    Object.keys(reqHeaders).forEach(key => {
                        safeHeaders[key] = reqHeaders[key];
                    });
                }
            } catch (e) {
                console.debug("[CR双语插件] 解析请求头失败", e);
            }
        }

        if (reqUrl && reqUrl.includes('/playback/v3/') && reqUrl.includes('/play')) {
            const retryKey = reqUrl;

            clone.json().then(data => {
                if (data && (data.subtitles || data.captions)) {
                    const payload = JSON.stringify({
                        url: reqUrl,
                        options: { headers: safeHeaders },
                        data: data
                    });
                    window.dispatchEvent(new CustomEvent("CR_SUBTITLE_DATA", { detail: payload }));
                    delete retryBackoffs[retryKey];
                }
            }).catch(e => {
                updateBackoff(retryKey);
            });
        }

        return response;
    };

    function getBackoff(key) {
        return retryBackoffs[key] || 500;
    }

    function updateBackoff(key) {
        const current = retryBackoffs[key] || 500;
        retryBackoffs[key] = Math.min(current * 2, 4000);
    }
})();