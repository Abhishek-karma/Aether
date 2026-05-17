import * as vscode from 'vscode';
import { ModelRouter } from '../llm/modelRouter';
import { sanitizeHtml } from '../utils/sanitize';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aetherChatView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _modelRouter: ModelRouter
    ) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aether.geminiModel') || 
                e.affectsConfiguration('aether.defaultModel') ||
                e.affectsConfiguration('aether.ollamaBaseUrl')) {
                this._modelRouter.invalidateCache();
                this._updateModels();
            }
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._updateModels();

        webviewView.webview.onDidReceiveMessage(data => {
            const cmdMap: Record<string, string> = {
                sendMessage: 'aether.sendMessage',
                stopGeneration: 'aether.stopGeneration',
                clearHistory: 'aether.clearHistory',
                getHistoryList: 'aether.getHistoryList',
                loadSession: 'aether.loadSession',
                toggleAutoApprove: 'aether.toggleAutoApprove',
            };
            if (data.type === 'sendMessage') {
                vscode.commands.executeCommand('aether.sendMessage', data.text, data.model);
            } else if (data.type === 'openSettings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'aether');
            } else if (data.type === 'acceptAction' || data.type === 'previewAction' || data.type === 'acceptCommand') {
                vscode.commands.executeCommand('aether.' + data.type.replace('accept', 'accept').replace('preview', 'preview'), data);
            } else if (data.type === 'loadSession') {
                vscode.commands.executeCommand('aether.loadSession', data.sessionId);
            } else if (cmdMap[data.type]) {
                vscode.commands.executeCommand(cmdMap[data.type]);
            }
        });
    }

    public postMessage(message: any) {
        if (this._view) {
            if (message.type === 'streamChunk' && message.chunk) {
                message.chunk = sanitizeHtml(message.chunk);
            }
            this._view.webview.postMessage(message);
        }
    }

    public async clearHistory() {
        this._view?.webview.postMessage({ type: 'historyLoaded', messages: [] });
    }

    public async submitInlineRequest(query: string, selection: string, path: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'startStream' });
            const fullPrompt = `Context from ${path}:\n\`\`\`\n${selection}\n\`\`\`\n\nQuestion: ${query}`;
            vscode.commands.executeCommand('aether.sendMessage', fullPrompt);
        }
    }

    private async _updateModels() {
        if (this._view) {
            try {
                const { models, defaultModel } = await this._modelRouter.listModels();
                this._view.webview.postMessage({ type: 'modelsLoaded', models, defaultModel });
            } catch (error) {
                console.error('Failed to load models:', error);
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; font-src ${webview.cspSource} https://cdnjs.cloudflare.com https://fonts.gstatic.com;`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <style>
        :root {
            --bg: var(--vscode-editor-background, #1e1e1e);
            --surface: var(--vscode-sideBar-background, #252526);
            --surface-hover: rgba(255,255,255,0.06);
            --border: var(--vscode-panel-border, #2d2d2d);
            --text: var(--vscode-editor-foreground, #d4d4d4);
            --text-secondary: var(--vscode-descriptionForeground, #888);
            --accent: #4fc3f7;
            --accent-dim: rgba(79,195,247,0.12);
            --accent-hover: #81d4fa;
            --green: #89d185;
            --green-dim: rgba(137,209,133,0.12);
            --red: #f48771;
            --orange: #e2b93d;
            --user-bg: linear-gradient(135deg, #1a6fb5, #1565c0);
            --assistant-bg: var(--surface);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            background: var(--bg); color: var(--text);
            font-family: 'Inter', var(--vscode-font-family, system-ui, sans-serif);
            font-size: 13px; line-height: 1.5;
            display: flex; flex-direction: column; height: 100vh; overflow: hidden;
        }

        /* ── Header ── */
        .header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 10px; height: 42px;
            background: var(--surface); border-bottom: 1px solid var(--border);
            flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 8px; }
        .header-logo {
            width: 22px; height: 22px; border-radius: 6px;
            background: linear-gradient(135deg, #4fc3f7, #29b6f6);
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 11px; color: #fff;
        }
        .header-title { font-weight: 600; font-size: 13px; color: var(--text); }
        .header-actions { display: flex; gap: 2px; }

        /* ── Icon Buttons ── */
        .ibtn {
            width: 28px; height: 28px; border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; border: none; background: transparent;
            color: var(--text-secondary); transition: all 0.15s;
        }
        .ibtn:hover { background: var(--surface-hover); color: var(--text); }
        .ibtn svg { width: 15px; height: 15px; }

        .ibtn.auto-on { color: var(--green) !important; background: var(--green-dim) !important; }

        /* ── Model Bar ── */
        .model-bar {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 12px; border-bottom: 1px solid var(--border);
            background: var(--bg); flex-shrink: 0;
        }
        .model-bar label { font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .model-bar select {
            flex: 1; background: var(--surface); color: var(--text);
            border: 1px solid var(--border); border-radius: 6px;
            padding: 5px 8px; font-size: 12px; font-family: inherit;
            outline: none; cursor: pointer; transition: border-color 0.2s;
        }
        .model-bar select:focus { border-color: var(--accent); }

        /* ── Messages Area ── */
        #messages {
            flex: 1; overflow-y: auto; padding: 16px 12px;
            display: flex; flex-direction: column; gap: 4px;
            scroll-behavior: smooth;
        }
        #messages::-webkit-scrollbar { width: 6px; }
        #messages::-webkit-scrollbar-track { background: transparent; }
        #messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        #messages::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

        /* ── Message Layout ── */
        .msg { display: flex; flex-direction: column; gap: 3px; max-width: 100%; animation: fadeIn 0.2s ease; }
        .msg-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); font-weight: 500; padding: 0 2px; margin-top: 12px; }
        .msg-label .avatar {
            width: 20px; height: 20px; border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
        }
        .msg-label .avatar.user-av { background: linear-gradient(135deg, #7c4dff, #651fff); }
        .msg-label .avatar.bot-av { background: linear-gradient(135deg, #4fc3f7, #0288d1); }

        .msg-body {
            padding: 10px 14px; border-radius: 12px;
            font-size: 13px; line-height: 1.6; word-wrap: break-word;
            min-height: 20px;
        }
        .msg-body.user-body {
            background: var(--user-bg); color: #fff;
            border-bottom-right-radius: 4px; align-self: flex-end;
        }
        .msg-body.bot-body {
            background: var(--assistant-bg); color: var(--text);
            border: 1px solid var(--border); border-bottom-left-radius: 4px;
        }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

        /* ── Markdown in bubbles ── */
        .msg-body p { margin: 0 0 8px; } .msg-body p:last-child { margin: 0; }
        .msg-body ul, .msg-body ol { padding-left: 18px; margin: 4px 0; }
        .msg-body li { margin: 2px 0; }
        .msg-body a { color: var(--accent); text-decoration: none; }
        .msg-body a:hover { text-decoration: underline; }
        .msg-body strong { font-weight: 600; }
        .msg-body blockquote { border-left: 3px solid var(--accent); padding-left: 10px; margin: 6px 0; color: var(--text-secondary); }
        .msg-body h1,.msg-body h2,.msg-body h3,.msg-body h4 { margin: 10px 0 4px; font-weight: 600; }
        .msg-body h1 { font-size: 16px; } .msg-body h2 { font-size: 15px; } .msg-body h3 { font-size: 14px; }

        /* ── Code ── */
        pre {
            background: #161b22 !important; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; padding: 12px 14px; overflow-x: auto;
            margin: 6px 0; position: relative;
        }
        code { font-family: var(--vscode-editor-font-family, 'Cascadia Code', monospace); font-size: 12px; }
        .copy-btn {
            position: absolute; top: 6px; right: 6px;
            background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1);
            color: var(--text-secondary); border-radius: 4px;
            padding: 3px 8px; font-size: 10px; cursor: pointer;
            font-family: inherit; transition: all 0.15s;
        }
        .copy-btn:hover { background: rgba(255,255,255,0.15); color: var(--text); }

        /* ── Think blocks ── */
        details.think-block {
            margin: 6px 0; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; padding: 0; background: rgba(0,0,0,0.15); overflow: hidden;
        }
        details.think-block summary {
            cursor: pointer; color: var(--text-secondary); font-size: 11px;
            padding: 8px 12px; outline: none; user-select: none; font-weight: 500;
            display: flex; align-items: center; gap: 6px;
        }
        details.think-block summary::before { content: '💭'; font-size: 12px; }
        details.think-block .think-content {
            font-size: 12px; color: var(--text-secondary);
            padding: 8px 12px 10px; white-space: pre-wrap; font-style: italic;
            border-top: 1px solid rgba(255,255,255,0.04);
        }

        /* ── Tool Cards ── */
        .tool-card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 10px; padding: 12px 14px; margin: 6px 0;
            animation: fadeIn 0.2s ease;
        }
        .tool-header {
            font-weight: 600; font-size: 12px; display: flex;
            align-items: center; gap: 6px; color: var(--text);
        }
        .tool-header svg { color: var(--accent); flex-shrink: 0; }
        .tool-file { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--text-secondary); margin: 6px 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tool-actions { display: flex; gap: 6px; }

        .btn-primary {
            background: var(--accent-dim); color: var(--accent);
            border: 1px solid rgba(79,195,247,0.2); border-radius: 6px;
            padding: 4px 12px; font-size: 11px; font-weight: 600;
            cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .btn-primary:hover { background: rgba(79,195,247,0.2); }

        .btn-ghost {
            background: transparent; color: var(--text-secondary);
            border: 1px solid var(--border); border-radius: 6px;
            padding: 4px 12px; font-size: 11px; font-weight: 500;
            cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .btn-ghost:hover { background: var(--surface-hover); color: var(--text); }

        .btn-green { background: var(--green-dim); color: var(--green); border-color: rgba(137,209,133,0.2); }
        .btn-green:hover { background: rgba(137,209,133,0.2); }

        .status-pill {
            font-size: 10px; font-weight: 600; padding: 2px 8px;
            border-radius: 10px; background: rgba(255,255,255,0.06);
        }
        .auto-badge {
            display: inline-flex; align-items: center;
            background: var(--green-dim); color: var(--green);
            font-size: 9px; font-weight: 700; padding: 2px 6px;
            border-radius: 4px; margin-left: auto; letter-spacing: 0.5px;
        }

        .tool-file-inline {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px; color: var(--text-secondary); font-weight: 400;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        /* ── Code Preview (Claude-style) ── */
        .code-preview {
            margin: 8px 0 6px; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px; overflow: hidden;
            background: #0d1117;
        }
        .code-preview summary {
            cursor: pointer; display: flex; align-items: center; gap: 6px;
            padding: 8px 12px; font-size: 11px; font-weight: 500;
            color: var(--text-secondary); user-select: none;
            background: rgba(255,255,255,0.02);
            border-bottom: 1px solid rgba(255,255,255,0.04);
            transition: background 0.15s;
            list-style: none;
        }
        .code-preview summary::-webkit-details-marker { display: none; }
        .code-preview summary::marker { display: none; content: ''; }
        .code-preview summary:hover { background: rgba(255,255,255,0.05); }
        .code-preview summary svg {
            transition: transform 0.2s;
        }
        .code-preview[open] summary svg {
            transform: rotate(90deg);
        }
        .code-preview-label {
            font-family: var(--vscode-editor-font-family, monospace);
            color: var(--accent); font-weight: 500;
        }
        .code-preview-meta {
            margin-left: auto; font-size: 10px; color: var(--text-secondary);
            opacity: 0.6;
        }
        .code-preview-body {
            max-height: 400px; overflow: auto;
        }
        .code-preview-body::-webkit-scrollbar { width: 6px; height: 6px; }
        .code-preview-body::-webkit-scrollbar-track { background: transparent; }
        .code-preview-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        .code-preview-pre {
            margin: 0 !important; border: none !important; border-radius: 0 !important;
            padding: 10px 14px !important; background: transparent !important;
        }
        .code-preview-inner {
            display: flex; gap: 16px;
        }
        .line-numbers {
            color: rgba(255,255,255,0.15); font-size: 11px;
            font-family: var(--vscode-editor-font-family, monospace);
            text-align: right; user-select: none; white-space: pre;
            line-height: 1.5; min-width: 28px; flex-shrink: 0;
        }
        .code-preview-pre code {
            white-space: pre; line-height: 1.5; display: block;
        }

        /* ── Input Area ── */
        .input-area { padding: 10px 12px; border-top: 1px solid var(--border); flex-shrink: 0; background: var(--bg); }
        .input-wrap {
            display: flex; align-items: flex-end; gap: 8px;
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 14px; padding: 8px 12px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-dim); }
        .input-wrap.disabled { opacity: 0.5; }
        .input-wrap.disabled textarea { pointer-events: none; }

        textarea#chat-input {
            flex: 1; background: transparent; border: none; color: var(--text);
            font-family: inherit; font-size: 13px; outline: none;
            resize: none; max-height: 120px; padding: 2px 0; line-height: 1.4;
        }
        textarea#chat-input::placeholder { color: var(--text-secondary); opacity: 0.5; }

        .input-btns { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .input-btns .ibtn { width: 26px; height: 26px; }
        .send-btn { color: var(--accent) !important; opacity: 0.35; pointer-events: none; transition: opacity 0.15s; }
        .send-btn.active { opacity: 1; pointer-events: auto; }
        .stop-btn { color: var(--red) !important; display: none; }
        .stop-btn.active { display: flex; }

        /* ── Empty State ── */
        .empty-state {
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; height: 100%; gap: 12px;
            color: var(--text-secondary); text-align: center; padding: 20px;
        }
        .empty-state .logo {
            width: 48px; height: 48px; border-radius: 14px;
            background: linear-gradient(135deg, #4fc3f7, #0288d1);
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; font-weight: 700; color: #fff;
            box-shadow: 0 4px 20px rgba(79,195,247,0.2);
        }
        .empty-state p { font-size: 12px; max-width: 220px; line-height: 1.5; }

        .typing-dots { display: flex; gap: 4px; padding: 8px 4px; }
        .typing-dots span {
            width: 6px; height: 6px; border-radius: 50%;
            background: var(--accent); opacity: 0.3;
            animation: pulse 1.2s infinite;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.15s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes pulse { 0%,100% { opacity:0.3; transform:scale(1); } 50% { opacity:1; transform:scale(1.2); } }

        /* ── Writing Indicator ── */
        .writing-indicator {
            display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
            padding: 10px 14px; margin: 6px 0;
            background: rgba(79,195,247,0.06);
            border: 1px solid rgba(79,195,247,0.12);
            border-radius: 10px;
            animation: fadeIn 0.3s ease;
        }
        .writing-spinner {
            display: flex; gap: 3px; align-items: center;
        }
        .writing-spinner span {
            width: 4px; height: 4px; border-radius: 50%;
            background: var(--accent); opacity: 0.4;
            animation: writePulse 1s infinite;
        }
        .writing-spinner span:nth-child(2) { animation-delay: 0.2s; }
        .writing-spinner span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes writePulse { 0%,100% { opacity:0.3; transform:scale(1); } 50% { opacity:1; transform:scale(1.4); } }
        .writing-label {
            font-size: 11px; font-weight: 600; color: var(--accent);
        }
        .writing-files {
            display: flex; flex-wrap: wrap; gap: 4px; width: 100%; margin-top: 2px;
        }
        .writing-file {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 10px; color: var(--text-secondary);
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 4px; padding: 2px 8px;
        }
        .generating-text {
            font-size: 12px; color: var(--text-secondary); font-style: italic;
            animation: fadeIn 0.3s ease;
        }

        /* ── History Panel ── */
        .history-panel {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg); z-index: 100;
            transform: translateX(100%); transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex; flex-direction: column;
        }
        .history-panel.open { transform: translateX(0); }
        
        .history-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; border-bottom: 1px solid var(--border);
            font-weight: 600; color: var(--text); font-size: 13px;
        }
        .close-history-btn {
            background: transparent; border: none; color: var(--text-secondary);
            cursor: pointer; padding: 4px; border-radius: 4px; display: flex;
        }
        .close-history-btn:hover { background: rgba(255,255,255,0.08); color: var(--text); }
        
        .history-list {
            flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px;
        }
        .history-item {
            padding: 12px; border-radius: 8px; cursor: pointer;
            border: 1px solid transparent; transition: all 0.15s;
            display: flex; flex-direction: column; gap: 4px;
        }
        .history-item:hover {
            background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.06);
        }
        .history-item.active {
            background: rgba(79,195,247,0.08); border-color: rgba(79,195,247,0.2);
        }
        .history-title { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.3; }
        .history-meta { font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="header-logo">A</div>
            <span class="header-title">Aether</span>
        </div>
        <div class="header-actions">
            <button class="ibtn" id="auto-approve-btn" title="Auto-Approve OFF">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.56 10.56l-2.94-2.94 1.06-1.06 1.88 1.88 5-5 1.06 1.06-6.06 6.06z"/></svg>
            </button>
            <button class="ibtn" id="history-btn" title="History">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0zM8 3v5l3.15 1.88.7-1.18L9 7.25V3H8z"/></svg>
            </button>
            <button class="ibtn" id="new-chat-btn" title="New Chat">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 7H9V2H7v5H2v2h5v5h2V9h5z"/></svg>
            </button>
            <button class="ibtn" id="settings-btn" title="Settings">
                <svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.1 1.4l1.2.4.8 1.5 1.6.1 1 .9-.3 1.6.9 1.3-.4 1.2-1.5.8-.1 1.6-.9 1-1.6-.3-1.3.9-1.2-.4-.8-1.5-1.6-.1-1-.9.3-1.6-.9-1.3.4-1.2 1.5-.8.1-1.6.9-1 1.6.3zM8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/></svg>
            </button>
        </div>
    </div>

    <div class="model-bar">
        <label>Model</label>
        <select id="model-select"></select>
    </div>

    <div id="messages"></div>

    <div class="input-area">
        <div class="input-wrap" id="input-container">
            <textarea id="chat-input" placeholder="Ask Aether anything..." rows="1"></textarea>
            <div class="input-btns">
                <button class="ibtn" id="clear-input" title="Clear">
                    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.7l3.6 3.7.8-.7L8.7 8l3.7-3.6-.7-.8L8 7.3 4.4 3.6l-.8.8L7.3 8l-3.7 3.6.8.8z"/></svg>
                </button>
                <button class="ibtn send-btn" id="send-btn" title="Send">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L14 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/></svg>
                </button>
                <button class="ibtn stop-btn" id="stop-btn" title="Stop">
                    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                </button>
            </div>
        </div>
    </div>

    <!-- History Overlay -->
    <div class="history-panel" id="history-panel">
        <div class="history-header">
            <span>Chat History</span>
            <button class="close-history-btn" id="close-history" title="Close">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.2 4.5l-.7-.7-3.5 3.5-3.5-3.5-.7.7 3.5 3.5-3.5 3.5.7.7 3.5-3.5 3.5 3.5.7-.7-3.5-3.5z"/></svg>
            </button>
        </div>
        <div class="history-list" id="history-list"></div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}
