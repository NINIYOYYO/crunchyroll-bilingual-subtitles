document.addEventListener('DOMContentLoaded', () => {
    const aiFields = document.getElementById('ai-fields');
    const engineSelect = document.getElementById('engine-select');
    const saveBtn = document.getElementById('save-btn');
    const statusEl = document.getElementById('save-status');

    const updateVisibility = () => { aiFields.style.display = engineSelect.value === 'custom_llm' ? 'block' : 'none'; };

    chrome.storage.local.get({
        secondLang: 'zh-CN', transMode: 'fallback', transEngine: 'custom_llm',
        apiUrl: '', aiModel: '', apiKey: '',
        batchSize: 10, concurrency: 3,
        reasoningEffort: 'medium' // ✨ 默认中等
    }, (s) => {
        document.getElementById('lang-select').value = s.secondLang || 'zh-CN';
        document.getElementById('mode-select').value = s.transMode || 'fallback';
        document.getElementById('engine-select').value = s.transEngine || 'custom_llm';
        document.getElementById('api-url').value = s.apiUrl || '';
        document.getElementById('ai-model').value = s.aiModel || '';
        document.getElementById('api-key').value = s.apiKey || '';
        document.getElementById('batch-size').value = s.batchSize || 10;
        document.getElementById('concurrency').value = s.concurrency || 3;
        document.getElementById('reasoning-effort').value = s.reasoningEffort || 'medium'; // ✨ 赋值
        updateVisibility();
    });

    engineSelect.addEventListener('change', updateVisibility);

    saveBtn.addEventListener('click', () => {
        const settings = {
            secondLang: document.getElementById('lang-select').value,
            transMode: document.getElementById('mode-select').value,
            transEngine: document.getElementById('engine-select').value,
            apiUrl: document.getElementById('api-url').value.trim(),
            aiModel: document.getElementById('ai-model').value.trim(),
            apiKey: document.getElementById('api-key').value.trim(),
            batchSize: parseInt(document.getElementById('batch-size').value) || 10,
            concurrency: parseInt(document.getElementById('concurrency').value) || 3,
            reasoningEffort: document.getElementById('reasoning-effort').value // ✨ 保存
        };

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        chrome.storage.local.set(settings, () => {
            showStatus('已保存，正在刷新...', 'success');
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.reload(tabs[0].id);
            });
        });
    });

    function showStatus(msg, type) {
        statusEl.textContent = msg;
        statusEl.className = 'status ' + type;
        statusEl.style.display = 'block';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    }
});