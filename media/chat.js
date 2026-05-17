// @ts-nocheck
(function () {
    var vscode = acquireVsCodeApi();
    var messages = document.getElementById('messages');
    var chatInput = document.getElementById('chat-input');
    var sendBtn = document.getElementById('send-btn');
    var stopBtn = document.getElementById('stop-btn');
    var clearBtn = document.getElementById('clear-input');
    var modelSelect = document.getElementById('model-select');
    var newChatBtn = document.getElementById('new-chat-btn');
    var historyBtn = document.getElementById('history-btn');
    var settingsBtn = document.getElementById('settings-btn');
    var autoApproveBtn = document.getElementById('auto-approve-btn');
    var inputWrap = document.getElementById('input-container');
    
    var historyPanel = document.getElementById('history-panel');
    var closeHistoryBtn = document.getElementById('close-history');
    var historyList = document.getElementById('history-list');

    var isStreaming = false, autoApprove = false;
    var curMsg = null, parseTimer = null;
    var toolCards = new Map();

    // Marked setup
    marked.setOptions({
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) try { return hljs.highlight(code, { language: lang }).value; } catch (e) { }
            return hljs.highlightAuto(code).value;
        },
        breaks: true
    });
    var ren = new marked.Renderer();
    ren.code = function (code, lang) {
        var ok = !!(lang && hljs.getLanguage(lang));
        var hl = ok ? hljs.highlight(code, { language: lang }).value : esc(code);
        return '<pre><button class="copy-btn" onclick="window._cp(this)">Copy</button><code class="' + (lang || '') + '">' + hl + '</code></pre>';
    };
    marked.use({ renderer: ren });

    window._cp = function (b) {
        var code = b.parentElement.querySelector('code').innerText;
        navigator.clipboard.writeText(code);
        var t = b.textContent; b.textContent = 'Copied!';
        setTimeout(function () { b.textContent = t; }, 1500);
    };

    function esc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function thinkTags(t) {
        if (!t) return '';
        return t.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, function (_, c) {
            return '<details class="think-block"><summary>Reasoning</summary><div class="think-content">' + esc(c) + '</div></details>';
        });
    }

    function scroll() { messages.scrollTop = messages.scrollHeight; }

    function emptyState() {
        if (messages.children.length === 0) {
            messages.innerHTML =
                '<div class="empty-state" id="empty-state">' +
                '<div class="logo">A</div>' +
                '<p>Hi, I\'m <strong>Aether</strong>. Ask me a coding question or give me a task.</p>' +
                '</div>';
        }
    }

    function rmEmpty() { var e = document.getElementById('empty-state'); if (e) e.remove(); }

    function addUser(content) {
        rmEmpty();
        var d = document.createElement('div'); d.className = 'msg';
        d.innerHTML =
            '<div class="msg-label"><div class="avatar user-av">Y</div>You</div>' +
            '<div class="msg-body user-body">' + marked.parse(esc(content)) + '</div>';
        messages.appendChild(d); scroll();
    }

    function addBot(content) {
        rmEmpty();
        var clean = stripToolBlocks(content);
        if (!clean.trim()) return; // Skip empty messages (all tool blocks)
        var d = document.createElement('div'); d.className = 'msg';
        d.innerHTML =
            '<div class="msg-label"><div class="avatar bot-av">A</div>Aether</div>' +
            '<div class="msg-body bot-body">' + marked.parse(thinkTags(clean)) + '</div>';
        messages.appendChild(d); scroll();
    }

    function setStreaming(on) {
        isStreaming = on;
        chatInput.disabled = on;
        if (on) {
            inputWrap.classList.add('disabled');
            sendBtn.style.display = 'none';
            stopBtn.classList.add('active');
        } else {
            inputWrap.classList.remove('disabled');
            sendBtn.style.display = 'flex';
            stopBtn.classList.remove('active');
            setTimeout(function () { chatInput.focus(); }, 10);
        }
    }

    function updateAutoUI() {
        if (autoApprove) {
            autoApproveBtn.classList.add('auto-on');
            autoApproveBtn.title = 'Auto-Approve ON';
        } else {
            autoApproveBtn.classList.remove('auto-on');
            autoApproveBtn.title = 'Auto-Approve OFF';
        }
    }

    chatInput.addEventListener('input', function () {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        sendBtn.classList.toggle('active', chatInput.value.trim().length > 0);
    });
    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    clearBtn.onclick = function () { chatInput.value = ''; chatInput.style.height = 'auto'; sendBtn.classList.remove('active'); chatInput.focus(); };
    sendBtn.onclick = send;
    stopBtn.onclick = function () { vscode.postMessage({ type: 'stopGeneration' }); };
    newChatBtn.onclick = function () { 
        vscode.postMessage({ type: 'clearHistory' }); 
        historyPanel.classList.remove('open');
    };
    historyBtn.onclick = function () { 
        vscode.postMessage({ type: 'getHistoryList' }); 
    };
    closeHistoryBtn.onclick = function() {
        historyPanel.classList.remove('open');
    };
    settingsBtn.onclick = function () { vscode.postMessage({ type: 'openSettings' }); };
    autoApproveBtn.onclick = function () { vscode.postMessage({ type: 'toggleAutoApprove' }); };

    function send() {
        var text = chatInput.value.trim();
        if (text && !isStreaming) {
            addUser(text);
            vscode.postMessage({ type: 'sendMessage', text: text, model: modelSelect.value });
            chatInput.value = ''; chatInput.style.height = 'auto'; sendBtn.classList.remove('active');
        }
    }

    // Strip aether-create/aether-edit fenced blocks from rendered text
    function stripToolBlocks(text) {
        if (!text) return '';
        // Remove complete blocks
        var stripped = text.replace(/```aether-(?:create|edit)\s+(?:path|file)=[^\n]+\n[\s\S]*?```/g, '');
        // Remove incomplete/in-progress blocks (block started but not closed)
        stripped = stripped.replace(/```aether-(?:create|edit)\s+(?:path|file)=[^\n]+\n[\s\S]*$/g, '');
        // Clean up excessive newlines left behind
        stripped = stripped.replace(/\n{3,}/g, '\n\n').trim();
        return stripped;
    }

    // Check if raw text contains any aether tool blocks
    function hasToolBlocks(text) {
        return /```aether-(?:create|edit)\s+(?:path|file)=/.test(text || '');
    }

    // Extract file names from in-progress tool blocks for the writing indicator
    function extractWritingFiles(text) {
        var files = [];
        var matches = (text || '').matchAll(/```aether-(?:create|edit)\s+(?:path|file)=([^\n]+)/g);
        for (var match of matches) {
            files.push(match[1].trim().replace(/^["']|["']$/g, ''));
        }
        return files;
    }

    var writingIndicator = null;

    function showWritingIndicator(files) {
        if (!writingIndicator) {
            writingIndicator = document.createElement('div');
            writingIndicator.className = 'writing-indicator';
            messages.appendChild(writingIndicator);
        }
        var fileList = files.map(function(f) {
            return '<span class="writing-file">' + esc(f) + '</span>';
        }).join('');
        writingIndicator.innerHTML =
            '<div class="writing-spinner"><span></span><span></span><span></span></div>' +
            '<span class="writing-label">Writing ' + files.length + ' file' + (files.length !== 1 ? 's' : '') + '...</span>' +
            '<div class="writing-files">' + fileList + '</div>';
        scroll();
    }

    function removeWritingIndicator() {
        if (writingIndicator) {
            writingIndicator.remove();
            writingIndicator = null;
        }
    }

    window.addEventListener('message', function (ev) {
        var m = ev.data;
        switch (m.type) {
            case 'autoApproveChanged': autoApprove = m.enabled; updateAutoUI(); break;
            case 'historyListLoaded':
                historyList.innerHTML = '';
                if (!m.sessions || m.sessions.length === 0) {
                    historyList.innerHTML = '<div style="padding:12px;color:var(--text-secondary);text-align:center;font-size:12px;">No chat history</div>';
                } else {
                    m.sessions.forEach(function(s) {
                        var div = document.createElement('div');
                        div.className = 'history-item' + (s.id === m.activeId ? ' active' : '');
                        var d = new Date(s.updatedAt);
                        
                        var snippet = 'Empty Session';
                        if (s.messages && s.messages.length > 0) {
                            snippet = s.messages[0].content.substring(0, 60).replace(/\n/g, ' ');
                            if (s.messages[0].content.length > 60) snippet += '...';
                        }
                        
                        div.innerHTML = 
                            '<div class="history-title">' + esc(s.title || 'New chat') + '</div>' +
                            '<div class="history-meta"><span>' + esc(snippet) + '</span><span>' + d.toLocaleDateString() + '</span></div>';
                        
                        div.onclick = function() {
                            vscode.postMessage({ type: 'loadSession', sessionId: s.id });
                            historyPanel.classList.remove('open');
                        };
                        historyList.appendChild(div);
                    });
                }
                historyPanel.classList.add('open');
                break;
            case 'historyLoaded':
                messages.innerHTML = '';
                if (m.messages && m.messages.length > 0) {
                    m.messages.forEach(function (x) { if (x.role === 'user') addUser(x.content); else addBot(x.content); });
                } else emptyState();
                break;
            case 'modelsLoaded':
                modelSelect.innerHTML = '';
                m.models.forEach(function (x) {
                    var o = document.createElement('option'); o.value = x.id; o.textContent = x.label;
                    if (x.id === m.defaultModel) o.selected = true;
                    modelSelect.appendChild(o);
                });
                break;
            case 'startStream':
                setStreaming(true); rmEmpty();
                curMsg = document.createElement('div'); curMsg.className = 'msg';
                curMsg.innerHTML =
                    '<div class="msg-label"><div class="avatar bot-av">A</div>Aether</div>' +
                    '<div class="msg-body bot-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
                messages.appendChild(curMsg); scroll();
                break;
            case 'streamChunk':
                if (curMsg) {
                    var b = curMsg.querySelector('.bot-body');
                    if (b.querySelector('.typing-dots')) b.innerHTML = '';
                    b.dataset.raw = (b.dataset.raw || '') + m.chunk;

                    // Strip tool blocks from displayed text
                    var displayText = stripToolBlocks(b.dataset.raw);

                    // Show writing indicator if tool blocks are being generated
                    var files = extractWritingFiles(b.dataset.raw);
                    if (files.length > 0) {
                        showWritingIndicator(files);
                    }

                    if (parseTimer) clearTimeout(parseTimer);
                    parseTimer = setTimeout(function () {
                        if (displayText.trim()) {
                            b.innerHTML = marked.parse(thinkTags(displayText));
                        } else {
                            // Only tool blocks, no explanation — show subtle status
                            b.innerHTML = '<span class="generating-text">Generating code...</span>';
                        }
                        scroll();
                    }, 50);
                }
                break;
            case 'endStream':
                setStreaming(false);
                removeWritingIndicator();
                // Final cleanup: render only explanation text (no tool blocks)
                if (curMsg) {
                    var body = curMsg.querySelector('.bot-body');
                    if (body && body.dataset.raw) {
                        var cleanText = stripToolBlocks(body.dataset.raw);
                        if (cleanText.trim()) {
                            body.innerHTML = marked.parse(thinkTags(cleanText));
                        } else {
                            // No explanation at all, remove the empty message bubble
                            body.innerHTML = '';
                            body.style.display = 'none';
                        }
                    }
                }
                curMsg = null;
                break;
            case 'showActionCard': showAction(m); break;
            case 'showCommandCard': showCmd(m); break;
            case 'updateToolCard': updTool(m); break;
            case 'fileActionResult': updFile(m); break;
            case 'error':
                setStreaming(false);
                removeWritingIndicator();
                if (curMsg) {
                    var body = curMsg.querySelector('.bot-body');
                    if (body && body.querySelector('.typing-dots')) {
                        curMsg.remove(); // Remove the stuck loading bubble
                    } else if (body && body.dataset.raw && !stripToolBlocks(body.dataset.raw).trim()) {
                        curMsg.remove();
                    }
                    curMsg = null;
                }
                var e = document.createElement('div'); e.className = 'msg';
                e.innerHTML = '<div class="msg-body bot-body" style="color:var(--red);border-color:rgba(244,135,113,0.3);">' + esc(m.message) + '</div>';
                messages.appendChild(e); scroll();
                break;
        }
    });

    function inferLang(filename) {
        var ext = (filename || '').split('.').pop().toLowerCase();
        var map = { ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript', py:'python', rs:'rust', go:'go', java:'java', cs:'csharp', cpp:'cpp', c:'c', rb:'ruby', php:'php', swift:'swift', kt:'kotlin', html:'html', css:'css', scss:'scss', json:'json', yaml:'yaml', yml:'yaml', md:'markdown', sh:'bash', bash:'bash', sql:'sql', dart:'dart', vue:'vue', svelte:'svelte', xml:'xml', svg:'xml', toml:'toml' };
        return map[ext] || ext || '';
    }

    function highlightCode(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try { return hljs.highlight(code, { language: lang }).value; } catch (e) { }
        }
        return hljs.highlightAuto(code).value;
    }

    function buildCodePreview(content, filename, collapsed) {
        var lang = inferLang(filename);
        var highlighted = highlightCode(content, lang);
        var lines = content.split('\n');
        var lineCount = lines.length;
        var label = lineCount + ' line' + (lineCount !== 1 ? 's' : '');

        var details = document.createElement('details');
        details.className = 'code-preview';
        if (!collapsed) { details.open = true; }

        var summary = document.createElement('summary');
        summary.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;"><path d="M4.7 12.3l4-4.3-4-4.3.7-.7 4.6 5-4.6 5z"/></svg>' +
            '<span class="code-preview-label">' + esc(filename) + '</span>' +
            '<span class="code-preview-meta">' + label + '</span>';
        details.appendChild(summary);

        var codeWrap = document.createElement('div');
        codeWrap.className = 'code-preview-body';

        // line numbers + code
        var lineNums = '<span class="line-numbers">';
        for (var i = 1; i <= lineCount; i++) { lineNums += i + '\n'; }
        lineNums += '</span>';

        codeWrap.innerHTML = '<pre class="code-preview-pre"><div class="code-preview-inner">' + lineNums + '<code class="' + lang + '">' + highlighted + '</code></div></pre>';
        details.appendChild(codeWrap);

        return details;
    }

    function showAction(m) {
        var c = document.createElement('div'); c.className = 'tool-card'; c.dataset.actionId = m.actionId;
        var isCreate = m.actionType === 'create';
        var icon = isCreate
            ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--green);"><path d="M12 3H8.41L7 1.59 6.59 2H2v12h10V3zm-1 8H8v3H7v-3H4V10h3V7h1v3h3v1z"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--accent);"><path d="M13.2 2.8a1 1 0 00-1.4 0L5 9.6V11h1.4l6.8-6.8a1 1 0 000-1.4zM4 12v1h8v-1H4z"/></svg>';
        var actionLabel = isCreate ? 'Create' : 'Edit';

        // Header
        var header = document.createElement('div');
        header.className = 'tool-header';
        header.innerHTML = icon + '<span>' + actionLabel + '</span>' +
            '<span class="tool-file-inline">' + esc(m.file) + '</span>';

        if (m.autoApplied) {
            var badge = document.createElement('span');
            badge.className = 'auto-badge';
            badge.textContent = 'AUTO';
            header.appendChild(badge);
        }
        c.appendChild(header);

        // Code preview
        if (m.content) {
            var preview = buildCodePreview(m.content, m.file, m.autoApplied);
            c.appendChild(preview);
        }

        // Buttons
        if (!m.autoApplied) {
            var btns = document.createElement('div');
            btns.className = 'tool-actions';
            btns.innerHTML =
                '<button class="btn-primary preview-btn">Diff</button>' +
                '<button class="btn-primary btn-green accept-btn">Apply</button>' +
                '<button class="btn-ghost reject-btn">Ignore</button>';
            c.appendChild(btns);

            btns.querySelector('.preview-btn').onclick = function () {
                vscode.postMessage({ type: 'previewAction', original: m.original, content: m.content, fullPath: m.fullPath });
            };
            btns.querySelector('.accept-btn').onclick = function () {
                header.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--orange)"><path d="M8 1a7 7 0 100 14A7 7 0 008 1z"/></svg> Applying...';
                btns.remove();
                vscode.postMessage({ type: 'acceptAction', actionId: m.actionId, actionType: m.actionType, file: m.file, content: m.content });
            };
            btns.querySelector('.reject-btn').onclick = function () { c.remove(); };
        }

        messages.appendChild(c); scroll();
    }

    function updFile(m) {
        var c = document.querySelector('[data-action-id="' + m.actionId + '"]');
        if (!c) return;
        if (m.ok) {
            var header = c.querySelector('.tool-header');
            // Preserve the filename from header
            var fileSpan = header.querySelector('.tool-file-inline');
            var fileName = fileSpan ? fileSpan.textContent : '';
            header.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color:var(--green)"><path d="M14.4 3.3l-8.5 10-.8 0-3.3-4.8.8-.6 2.9 4.1 8-9.4.9.7z"/></svg>' +
                '<span style="color:var(--green)">Applied</span>' +
                (fileName ? '<span class="tool-file-inline">' + esc(fileName) + '</span>' : '');
            // Collapse the code preview
            var preview = c.querySelector('.code-preview');
            if (preview) { preview.removeAttribute('open'); }
            c.style.opacity = '0.6';
            c.querySelectorAll('.tool-actions').forEach(function (b) { b.remove(); });
        } else {
            c.querySelector('.tool-header').innerHTML = '<span style="color:var(--red)">Failed: ' + esc(m.message) + '</span>';
        }
    }

    function showCmd(m) {
        if (m.autoApplied) {
            var tc = mkTool(m.actionId, 'Command', m.command, 'running');
            var badge = document.createElement('span'); badge.className = 'auto-badge'; badge.textContent = 'AUTO';
            tc.root.querySelector('.tool-header').appendChild(badge);
            toolCards.set(m.actionId, tc); messages.appendChild(tc.root); scroll();
            return;
        }
        var tc = mkTool(m.actionId, 'Command', m.command, 'pending');
        var desc = document.createElement('div');
        desc.style.cssText = 'font-size:11px;color:var(--text-secondary);margin:6px 0 10px;';
        desc.textContent = m.reason;
        tc.root.appendChild(desc);
        var btns = document.createElement('div'); btns.className = 'tool-actions';
        btns.innerHTML = '<button class="btn-primary btn-green run-btn">Run</button><button class="btn-ghost skip-btn">Skip</button>';
        tc.root.appendChild(btns);
        btns.querySelector('.run-btn').onclick = function () {
            btns.remove(); desc.remove();
            updTool({ actionId: m.actionId, status: 'running' });
            vscode.postMessage({ type: 'acceptCommand', actionId: m.actionId, command: m.command });
        };
        btns.querySelector('.skip-btn').onclick = function () { tc.root.remove(); };
        toolCards.set(m.actionId, tc); messages.appendChild(tc.root); scroll();
    }

    function mkTool(id, tool, title, status) {
        var root = document.createElement('div'); root.className = 'tool-card';
        root.innerHTML =
            '<div class="tool-header" style="justify-content:space-between;">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + tool + ': ' + esc(title) + '</span>' +
            '<span class="status-pill"></span></div>' +
            '<div class="output" style="background:#0d1117;border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px;margin-top:8px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;max-height:200px;overflow:auto;display:none;"></div>';
        var card = { root: root, pill: root.querySelector('.status-pill'), output: root.querySelector('.output') };
        setStatus(card, status); return card;
    }

    function updTool(m) {
        var c = toolCards.get(m.actionId);
        if (c) { setStatus(c, m.status); if (m.output) { c.output.textContent = m.output; c.output.style.display = 'block'; } }
        scroll();
    }

    function setStatus(c, s) {
        c.pill.textContent = s === 'running' ? 'Running…' : s === 'done' ? 'Done' : s === 'error' ? 'Error' : 'Pending';
        c.pill.style.color = s === 'done' ? 'var(--green)' : s === 'error' ? 'var(--red)' : 'var(--orange)';
    }

    emptyState(); updateAutoUI();
})();
