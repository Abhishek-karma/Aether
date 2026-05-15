// @ts-nocheck
/* Aether Chat Webview Script */
(function () {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-input');
    const modelSelect = document.getElementById('model-select');
    const newChatBtn = document.getElementById('new-chat-btn');
    const historyBtn = document.getElementById('history-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const autoApproveBtn = document.getElementById('auto-approve-btn');
    const inputContainer = document.getElementById('input-container');

    let isStreaming = false;
    let autoApproveEnabled = false;
    let currentAssistantMessage = null;
    let parseTimer = null;
    const toolCards = new Map();

    // Configure marked
    marked.setOptions({
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try { return hljs.highlight(code, { language: lang }).value; } catch (e) { }
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true
    });

    // Custom renderer for copy buttons
    const renderer = new marked.Renderer();
    renderer.code = function (code, language) {
        const validLang = !!(language && hljs.getLanguage(language));
        const highlighted = validLang ? hljs.highlight(code, { language: language }).value : escapeHtml(code);
        return '<pre><button class="copy-btn" onclick="window._copyCode(this)">Copy</button><code class="' + (language || 'plaintext') + '">' + highlighted + '</code></pre>';
    };
    marked.use({ renderer: renderer });

    window._copyCode = function (button) {
        var pre = button.parentElement;
        var code = pre.querySelector('code').innerText;
        navigator.clipboard.writeText(code);
        var orig = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(function () { button.textContent = orig; }, 2000);
    };

    function escapeHtml(unsafe) {
        return (unsafe || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function processThinkTags(text) {
        if (!text) return '';
        return text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, function (match, thinkContent) {
            return '<details class="think-block"><summary>Thinking process...</summary><div class="think-content">' + escapeHtml(thinkContent) + '</div></details>';
        });
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function showEmptyState() {
        if (messagesContainer.children.length === 0) {
            messagesContainer.innerHTML =
                '<div class="empty-state" id="empty-state">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>' +
                '<p>Hi, I\'m Aether. Ask me a coding question or give me a task to help you with your workspace.</p>' +
                '</div>';
        }
    }

    function removeEmptyState() {
        var empty = document.getElementById('empty-state');
        if (empty) empty.remove();
    }

    function appendUserMessage(content) {
        removeEmptyState();
        var row = document.createElement('div');
        row.className = 'message-row user-row';
        row.innerHTML =
            '<div class="message-wrapper user-wrapper">' +
            '<div class="sender-info">You</div>' +
            '<div class="message-bubble user-bubble">' + marked.parse(escapeHtml(content)) + '</div>' +
            '</div>';
        messagesContainer.appendChild(row);
        scrollToBottom();
    }

    function appendAssistantMessage(content) {
        removeEmptyState();
        var row = document.createElement('div');
        row.className = 'message-row assistant-row';
        var parsedContent = marked.parse(processThinkTags(content));
        row.innerHTML =
            '<div class="message-wrapper assistant-wrapper">' +
            '<div class="sender-info"><div class="assistant-avatar">A</div>Aether</div>' +
            '<div class="message-bubble assistant-bubble">' + parsedContent + '</div>' +
            '</div>';
        messagesContainer.appendChild(row);
        scrollToBottom();
    }

    function toggleInputState(streaming) {
        isStreaming = streaming;
        chatInput.disabled = streaming;
        if (streaming) {
            inputContainer.classList.add('disabled');
            sendBtn.style.display = 'none';
            stopBtn.classList.add('active');
        } else {
            inputContainer.classList.remove('disabled');
            sendBtn.style.display = 'flex';
            stopBtn.classList.remove('active');
            setTimeout(function () { chatInput.focus(); }, 10);
        }
    }

    function updateAutoApproveUI() {
        if (autoApproveEnabled) {
            autoApproveBtn.classList.add('toggled');
            autoApproveBtn.title = 'Auto-Approve ON — changes applied automatically';
        } else {
            autoApproveBtn.classList.remove('toggled');
            autoApproveBtn.title = 'Auto-Approve OFF — click to enable';
        }
    }

    chatInput.addEventListener('input', function () {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        sendBtn.classList.toggle('active', chatInput.value.trim().length > 0);
    });

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    clearBtn.onclick = function () {
        chatInput.value = '';
        chatInput.style.height = 'auto';
        sendBtn.classList.remove('active');
        chatInput.focus();
    };

    sendBtn.onclick = sendMessage;
    stopBtn.onclick = function () { vscode.postMessage({ type: 'stopGeneration' }); };
    newChatBtn.onclick = function () { vscode.postMessage({ type: 'clearHistory' }); };
    historyBtn.onclick = function () { vscode.postMessage({ type: 'showHistory' }); };
    settingsBtn.onclick = function () { vscode.postMessage({ type: 'openSettings' }); };
    autoApproveBtn.onclick = function () { vscode.postMessage({ type: 'toggleAutoApprove' }); };

    function sendMessage() {
        var text = chatInput.value.trim();
        if (text && !isStreaming) {
            appendUserMessage(text);
            vscode.postMessage({ type: 'sendMessage', text: text, model: modelSelect.value });
            chatInput.value = '';
            chatInput.style.height = 'auto';
            sendBtn.classList.remove('active');
        }
    }

    window.addEventListener('message', function (event) {
        var message = event.data;
        switch (message.type) {
            case 'autoApproveChanged':
                autoApproveEnabled = message.enabled;
                updateAutoApproveUI();
                break;
            case 'historyLoaded':
                messagesContainer.innerHTML = '';
                if (message.messages && message.messages.length > 0) {
                    message.messages.forEach(function (m) {
                        if (m.role === 'user') appendUserMessage(m.content);
                        else appendAssistantMessage(m.content);
                    });
                } else {
                    showEmptyState();
                }
                break;
            case 'modelsLoaded':
                modelSelect.innerHTML = '';
                message.models.forEach(function (m) {
                    var opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.label;
                    if (m.id === message.defaultModel) opt.selected = true;
                    modelSelect.appendChild(opt);
                });
                break;
            case 'startStream':
                toggleInputState(true);
                removeEmptyState();
                currentAssistantMessage = document.createElement('div');
                currentAssistantMessage.className = 'message-row assistant-row';
                currentAssistantMessage.innerHTML =
                    '<div class="message-wrapper assistant-wrapper">' +
                    '<div class="sender-info"><div class="assistant-avatar">A</div>Aether</div>' +
                    '<div class="message-bubble assistant-bubble">' +
                    '<div class="typing-dots"><span></span><span></span><span></span></div>' +
                    '</div></div>';
                messagesContainer.appendChild(currentAssistantMessage);
                scrollToBottom();
                break;
            case 'streamChunk':
                if (currentAssistantMessage) {
                    var bubble = currentAssistantMessage.querySelector('.assistant-bubble');
                    if (bubble.querySelector('.typing-dots')) bubble.innerHTML = '';
                    bubble.dataset.raw = (bubble.dataset.raw || '') + message.chunk;
                    if (parseTimer) clearTimeout(parseTimer);
                    parseTimer = setTimeout(function () {
                        bubble.innerHTML = marked.parse(processThinkTags(bubble.dataset.raw));
                        scrollToBottom();
                    }, 50);
                }
                break;
            case 'endStream':
                toggleInputState(false);
                currentAssistantMessage = null;
                break;
            case 'showActionCard': showActionCard(message); break;
            case 'showCommandCard': showCommandCard(message); break;
            case 'updateToolCard': updateToolCard(message); break;
            case 'fileActionResult': updateFileActionCard(message); break;
            case 'error':
                toggleInputState(false);
                var err = document.createElement('div');
                err.className = 'message-bubble assistant-bubble';
                err.style.color = 'var(--vscode-errorForeground)';
                err.textContent = message.message;
                messagesContainer.appendChild(err);
                scrollToBottom();
                break;
        }
    });

    // --- Tool Card Implementations ---
    function showActionCard(message) {
        var card = document.createElement('div');
        card.className = 'tool-card';
        card.dataset.actionId = message.actionId;

        if (message.autoApplied) {
            // Auto-applied: show a compact status card (no buttons)
            card.innerHTML =
                '<div class="tool-header">' +
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2H6L5.5 2.5v11l.5.5h8l.5-.5v-11l-.5-.5zM14 13H6V3h8v10zM4 5.5l-.5-.5H1v1h2V14h9v2H2.5l-.5-.5v-10z"/></svg> ' +
                (message.actionType === 'create' ? 'Creating' : 'Editing') + ': ' +
                '<span style="opacity:0.7; font-weight:normal;">' + escapeHtml(message.file) + '</span>' +
                '<span class="auto-badge">AUTO</span>' +
                '</div>';
        } else {
            // Manual mode: show full interactive card
            card.innerHTML =
                '<div class="tool-header">' +
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2H6L5.5 2.5v11l.5.5h8l.5-.5v-11l-.5-.5zM14 13H6V3h8v10zM4 5.5l-.5-.5H1v1h2V14h9v2H2.5l-.5-.5v-10z"/></svg> ' +
                (message.actionType === 'create' ? 'Create File' : 'Edit File') +
                '</div>' +
                '<div style="font-family:var(--vscode-editor-font-family); opacity:0.8; margin-bottom:12px; font-size:11px; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(message.file) + '</div>' +
                '<div style="display:flex; gap:8px;">' +
                '<button class="primary preview-btn">Diff</button>' +
                '<button class="primary accept-btn">Apply</button>' +
                '<button class="secondary reject-btn">Ignore</button>' +
                '</div>';
        }

        messagesContainer.appendChild(card);
        scrollToBottom();

        if (!message.autoApplied) {
            card.querySelector('.preview-btn').onclick = function () {
                vscode.postMessage({ type: 'previewAction', original: message.original, content: message.content, fullPath: message.fullPath });
            };
            card.querySelector('.accept-btn').onclick = function () {
                card.querySelector('.tool-header').textContent = 'Applying...';
                vscode.postMessage({ type: 'acceptAction', actionId: message.actionId, actionType: message.actionType, file: message.file, content: message.content });
            };
            card.querySelector('.reject-btn').onclick = function () { card.remove(); };
        }
    }

    function updateFileActionCard(message) {
        var card = document.querySelector('[data-action-id="' + message.actionId + '"]');
        if (card) {
            if (message.ok) {
                card.querySelector('.tool-header').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.878 4.09 8.004-9.45.91.74z"/></svg> Applied';
                card.style.opacity = '0.6';
                var buttons = card.querySelectorAll('button');
                buttons.forEach(function (b) { b.remove(); });
            } else {
                card.querySelector('.tool-header').textContent = 'Failed: ' + message.message;
                card.style.borderColor = '#f48771';
            }
        }
    }

    function showCommandCard(message) {
        if (message.autoApplied) {
            // Auto-run: show compact running card
            var card = createToolCard(message.actionId, 'Command', message.command, 'running');
            var badge = document.createElement('span');
            badge.className = 'auto-badge';
            badge.textContent = 'AUTO';
            card.root.querySelector('.status-pill').parentElement.appendChild(badge);
            toolCards.set(message.actionId, card);
            messagesContainer.appendChild(card.root);
            scrollToBottom();
            return;
        }

        var card = createToolCard(message.actionId, 'Command', message.command, 'pending');
        var desc = document.createElement('div');
        desc.style.cssText = 'font-size:11px; opacity:0.7; margin-top:4px;';
        desc.textContent = message.reason;
        card.root.appendChild(desc);
        var buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex; gap:8px; margin-top:12px;';
        buttons.innerHTML = '<button class="primary run-btn">Run</button><button class="secondary skip-btn">Skip</button>';
        card.root.appendChild(buttons);
        card.root.querySelector('.run-btn').onclick = function () {
            buttons.remove();
            updateToolCard({ actionId: message.actionId, status: 'running' });
            vscode.postMessage({ type: 'acceptCommand', actionId: message.actionId, command: message.command });
        };
        card.root.querySelector('.skip-btn').onclick = function () { card.root.remove(); };
        toolCards.set(message.actionId, card);
        messagesContainer.appendChild(card.root);
        scrollToBottom();
    }

    function createToolCard(actionId, tool, title, status) {
        var root = document.createElement('div');
        root.className = 'tool-card';
        root.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; font-size:12px;">' + tool + ': ' + escapeHtml(title) + '</div>' +
            '<div class="status-pill"></div>' +
            '</div>' +
            '<div class="output" style="background:#121212; border:1px solid var(--border); border-radius:4px; padding:8px; margin-top:8px; font-family:var(--vscode-editor-font-family); font-size:11px; max-height:200px; overflow:auto; display:none;"></div>';
        var card = { root: root, statusPill: root.querySelector('.status-pill'), output: root.querySelector('.output') };
        updateToolStatus(card, status);
        return card;
    }

    function updateToolCard(message) {
        var card = toolCards.get(message.actionId);
        if (card) {
            updateToolStatus(card, message.status);
            if (message.output) { card.output.textContent = message.output; card.output.style.display = 'block'; }
        }
        scrollToBottom();
    }

    function updateToolStatus(card, status) {
        card.statusPill.textContent = status === 'running' ? 'Running...' : status === 'done' ? 'Done' : status === 'error' ? 'Error' : 'Pending';
        card.statusPill.style.color = status === 'done' ? '#89d185' : status === 'error' ? '#f48771' : '#cca700';
    }

    // Init
    showEmptyState();
    updateAutoApproveUI();
})();
