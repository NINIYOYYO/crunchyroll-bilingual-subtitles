document.addEventListener("DOMContentLoaded", () => {
    const aiFields = document.getElementById("ai-fields");
    const engineSelect = document.getElementById("engine-select");
    const saveBtn = document.getElementById("save-btn");
    const statusEl = document.getElementById("save-status");

    // I18N: set all dynamic text
    document.getElementById("title").textContent = chrome.i18n.getMessage("popup_title");
    document.getElementById("label-lang").textContent = chrome.i18n.getMessage("target_language");
    document.getElementById("label-mode").textContent = chrome.i18n.getMessage("translation_mode");
    document.getElementById("label-engine").textContent = chrome.i18n.getMessage("translation_engine");
    document.getElementById("label-api-url").textContent = chrome.i18n.getMessage("api_url_label");
    document.getElementById("label-model").textContent = chrome.i18n.getMessage("model_label");
    document.getElementById("label-api-key").textContent = chrome.i18n.getMessage("api_key_label");
    document.getElementById("label-effort").textContent = chrome.i18n.getMessage("reasoning_effort_label");
    document.getElementById("label-streaming").textContent = chrome.i18n.getMessage("streaming_label");
    document.getElementById("label-batch").textContent = chrome.i18n.getMessage("batch_size_label");
    document.getElementById("label-concurrency").textContent = chrome.i18n.getMessage("concurrency_label");
    saveBtn.textContent = chrome.i18n.getMessage("save_button");

    // I18N: set placeholders
    document.getElementById("api-url").placeholder = chrome.i18n.getMessage("api_url_placeholder");
    document.getElementById("ai-model").placeholder = chrome.i18n.getMessage("model_placeholder");
    document.getElementById("api-key").placeholder = chrome.i18n.getMessage("api_key_placeholder");

    // I18N: set select option texts
    const langSelect = document.getElementById("lang-select");
    const modeSelect = document.getElementById("mode-select");
    const engineSelectEl = document.getElementById("engine-select");

    // Set option texts (keep values unchanged)
    // Note: lang options are already set via __MSG__ in HTML attributes if needed,
    // but for simplicity we set them here or rely on messages.json
    // Actually for <option> text, we need to set each one:
    // This is simpler: just set the ones that need i18n
    // For lang-select options, the values are language codes, text is set via messages.json keys like lang_zh_cn
    // We'll set them by iterating options
    Array.from(langSelect.options).forEach(opt => {
        const key = "lang_" + opt.value.replace("-", "_").toLowerCase();
        const msg = chrome.i18n.getMessage(key);
        if (msg) opt.textContent = msg;
    });
    Array.from(modeSelect.options).forEach(opt => {
        const key = "mode_" + opt.value;
        const msg = chrome.i18n.getMessage(key);
        if (msg) opt.textContent = msg;
    });
    Array.from(engineSelectEl.options).forEach(opt => {
        const key = "engine_" + opt.value.replace("_llm", "");
        const msg = chrome.i18n.getMessage(key);
        if (msg) opt.textContent = msg;
    });

    const updateVisibility = () => {
        aiFields.style.display = engineSelect.value === "custom_llm" ? "block" : "none";
    };

    chrome.storage.local.get({
        secondLang: "zh-CN",
        transMode: "fallback",
        transEngine: "custom_llm",
        apiUrl: "",
        aiModel: "",
        apiKey: "",
        batchSize: 10,
        concurrency: 3,
        reasoningEnabled: true,
        streaming: true
    }, (s) => {
        langSelect.value = s.secondLang || "zh-CN";
        modeSelect.value = s.transMode || "fallback";
        engineSelect.value = s.transEngine || "custom_llm";
        document.getElementById("api-url").value = s.apiUrl || "";
        document.getElementById("ai-model").value = s.aiModel || "";
        document.getElementById("api-key").value = s.apiKey || "";
        document.getElementById("batch-size").value = s.batchSize || 10;
        document.getElementById("concurrency").value = s.concurrency || 3;
        document.getElementById("reasoning-toggle").checked = s.reasoningEnabled !== false;
        document.getElementById("streaming-toggle").checked = s.streaming !== false;
        updateVisibility();
    });

    engineSelect.addEventListener("change", updateVisibility);

    saveBtn.addEventListener("click", () => {
        const settings = {
            secondLang: langSelect.value,
            transMode: modeSelect.value,
            transEngine: engineSelect.value,
            apiUrl: document.getElementById("api-url").value.trim(),
            aiModel: document.getElementById("ai-model").value.trim(),
            apiKey: document.getElementById("api-key").value.trim(),
            batchSize: parseInt(document.getElementById("batch-size").value) || 10,
            concurrency: parseInt(document.getElementById("concurrency").value) || 3,
            reasoningEnabled: document.getElementById("reasoning-toggle").checked,
            streaming: document.getElementById("streaming-toggle").checked
        };

        saveBtn.disabled = true;
        saveBtn.textContent = chrome.i18n.getMessage("saving");

        chrome.storage.local.set(settings, () => {
            showStatus(chrome.i18n.getMessage("saved_refreshing"), "success");
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.reload(tabs[0].id);
            });
        });
    });

    function showStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = "status " + type;
        statusEl.style.display = "block";
        setTimeout(() => { statusEl.style.display = "none"; }, 3000);
    }
});