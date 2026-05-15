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
        // Listen for model-related configuration changes
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

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Initial model population
        this._updateModels();

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'sendMessage':
                    vscode.commands.executeCommand('aether.sendMessage', data.text, data.model);
                    break;
                case 'stopGeneration':
                    vscode.commands.executeCommand('aether.stopGeneration');
                    break;
                case 'acceptAction':
                    vscode.commands.executeCommand('aether.acceptAction', data);
                    break;
                case 'previewAction':
                    vscode.commands.executeCommand('aether.previewAction', data);
                    break;
                case 'acceptCommand':
                    vscode.commands.executeCommand('aether.acceptCommand', data);
                    break;
                case 'clearHistory':
                    vscode.commands.executeCommand('aether.clearHistory');
                    break;
                case 'showHistory':
                    vscode.commands.executeCommand('aether.showHistory');
                    break;
                case 'toggleAutoApprove':
                    vscode.commands.executeCommand('aether.toggleAutoApprove');
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'aether');
                    break;
            }
        });
    }

    public postMessage(message: any) {
        if (this._view) {
            // Sanitize chunks before sending to webview to prevent XSS
            if (message.type === 'streamChunk' && message.chunk) {
                message.chunk = sanitizeHtml(message.chunk);
            }
            this._view.webview.postMessage(message);
        }
    }

    public async clearHistory() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'historyLoaded', messages: [] });
        }
    }

    public async submitInlineRequest(query: string, selection: string, path: string) {
        if (this._view) {
            this._view.webview.postMessage({ 
                type: 'startStream'
            });
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
        
        // Get local script URI
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js')
        );
        
        // Security: Restrict resources and scripts.
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com`,
            `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com`,
            `font-src ${webview.cspSource} https://cdnjs.cloudflare.com`
        ].join('; ') + ';';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <style>
        :root {
            --background: var(--vscode-editor-background, #1e1e1e);
            --surface: var(--vscode-sideBar-background, #252526);
            --border: var(--vscode-panel-border, #333);
            --text-main: var(--vscode-editor-foreground, #d4d4d4);
            --text-muted: var(--vscode-descriptionForeground, #9d9d9d);
            --accent: var(--vscode-button-background, #0e639c);
            --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
            --assistant-bubble: #2a2a2a;
            --user-bubble: #005a9e;
            --font-family: var(--vscode-font-family, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        }
        * { box-sizing: border-box; }
        body {
            background-color: var(--background); color: var(--text-main);
            font-family: var(--font-family); margin: 0; padding: 0;
            display: flex; flex-direction: column; height: 100vh; overflow: hidden;
        }
        button { background:transparent; border:none; color:var(--text-main); font-family:inherit; cursor:pointer; display:flex; align-items:center; justify-content:center; }
        button.icon-btn { padding:4px; border-radius:4px; }
        button.icon-btn:hover { background:rgba(255,255,255,0.1); }
        button.primary { background:var(--accent); color:white; padding:4px 8px; border-radius:4px; }
        button.primary:hover { background:var(--accent-hover); }
        button.secondary { background:rgba(255,255,255,0.1); color:var(--text-main); padding:4px 8px; border-radius:4px; }
        button.secondary:hover { background:rgba(255,255,255,0.2); }
        select { background:var(--surface); color:var(--text-main); border:1px solid var(--border); border-radius:4px; padding:4px 8px; font-family:inherit; font-size:13px; outline:none; cursor:pointer; width:100%; }
        select:focus { border-color:var(--accent); }

        .header { height:48px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; background-color:var(--surface); border-bottom:1px solid var(--border); flex-shrink:0; z-index:100; }
        .header-left { display:flex; align-items:center; gap:8px; }
        .header-title { font-weight:600; font-size:13px; letter-spacing:0.5px; }
        .header-icon { color:var(--accent); display:flex; align-items:center; }
        .header-right { display:flex; gap:4px; }

        .model-container { padding:8px 12px; border-bottom:1px solid var(--border); background:var(--background); display:flex; align-items:center; gap:12px; flex-shrink:0; }
        .model-label { font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; }
        .model-select-wrapper { flex:1; }

        #messages { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px; scroll-behavior:smooth; }

        .message-row { display:flex; width:100%; margin-bottom:4px; }
        .user-row { justify-content:flex-end; }
        .assistant-row { justify-content:flex-start; }
        .message-wrapper { max-width:85%; display:flex; flex-direction:column; gap:4px; }
        .user-wrapper { align-items:flex-end; }
        .assistant-wrapper { align-items:flex-start; }
        .sender-info { font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
        .assistant-avatar { width:18px; height:18px; background:var(--accent); color:white; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; }

        .message-bubble { padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.5; word-wrap:break-word; position:relative; transition:transform 0.1s ease; width:100%; }
        .message-bubble:hover { transform:translateY(-1px); }
        .user-bubble { background-color:var(--user-bubble); color:#ffffff; border-bottom-right-radius:2px; }
        .assistant-bubble { background-color:var(--assistant-bubble); color:var(--text-main); border:1px solid var(--border); border-bottom-left-radius:2px; }

        .tool-card { background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; padding:12px; margin:8px 0; width:100%; }
        .tool-header { font-weight:600; font-size:12px; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
        .status-pill { font-size:10px; padding:2px 8px; border-radius:10px; background:rgba(255,255,255,0.1); }

        .input-area { padding:12px; background-color:var(--background); border-top:1px solid var(--border); flex-shrink:0; }
        .input-container { background:var(--surface); border:1px solid var(--border); border-radius:24px; padding:8px 16px; display:flex; align-items:center; gap:12px; transition:border-color 0.2s ease; }
        .input-container:focus-within { border-color:var(--accent); }
        .input-container.disabled { opacity:0.6; }
        .input-container.disabled #chat-input { pointer-events:none; }

        #chat-input { flex:1; background:transparent; border:none; color:var(--text-main); font-family:inherit; font-size:13px; outline:none; resize:none; max-height:120px; padding:4px 0; }
        #chat-input::placeholder { color:var(--text-muted); opacity:0.6; }

        .action-buttons { display:flex; align-items:center; gap:8px; }
        .icon-btn { cursor:pointer; color:var(--text-muted); opacity:0.7; transition:all 0.2s; display:flex; align-items:center; justify-content:center; }
        .icon-btn:hover { color:var(--text-main); opacity:1; }
        .send-btn { color:var(--accent); opacity:0.5; pointer-events:none; }
        .send-btn.active { opacity:1; pointer-events:auto; }
        .stop-btn { color:#f48771; display:none; }
        .stop-btn.active { display:flex; }

        #messages::-webkit-scrollbar { width:10px; }
        #messages::-webkit-scrollbar-track { background:transparent; }
        #messages::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:5px; border:3px solid var(--background); }
        #messages::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.2); }

        pre { background:#1a1a1a !important; padding:12px; border-radius:8px; border:1px solid var(--border); overflow-x:auto; position:relative; }
        code { font-family:var(--vscode-editor-font-family, monospace); font-size:12px; }
        p { margin:0 0 10px 0; }
        p:last-child { margin-bottom:0; }
        .copy-btn { position:absolute; top:4px; right:4px; background:rgba(255,255,255,0.1); border:none; color:var(--text-muted); border-radius:4px; padding:4px; font-size:10px; cursor:pointer; }
        .copy-btn:hover { background:rgba(255,255,255,0.2); color:var(--text-main); }

        details.think-block { margin-bottom:10px; border:1px solid var(--border); border-radius:6px; padding:6px; background:rgba(0,0,0,0.1); }
        details.think-block summary { cursor:pointer; color:var(--text-muted); font-size:11px; padding:2px 4px; outline:none; user-select:none; }
        details.think-block .think-content { font-size:12px; color:var(--text-muted); padding:8px; margin-top:4px; white-space:pre-wrap; font-style:italic; }

        .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); text-align:center; gap:16px; padding:20px; }
        .empty-state svg { width:48px; height:48px; color:var(--border); }
        .empty-state p { font-size:13px; max-width:250px; }

        .typing-dots { display:flex; gap:4px; padding:6px 0; }
        .typing-dots span { width:6px; height:6px; background:var(--text-muted); border-radius:50%; opacity:0.4; animation:blink 1.4s infinite; }
        .typing-dots span:nth-child(2) { animation-delay:0.2s; }
        .typing-dots span:nth-child(3) { animation-delay:0.4s; }
        @keyframes blink { 0%,100% { opacity:0.4; transform:scale(1); } 50% { opacity:1; transform:scale(1.1); } }

        .auto-approve-btn { position:relative; transition:all 0.2s; }
        .auto-approve-btn.toggled { color:#89d185 !important; background:rgba(137,209,133,0.15) !important; }
        .auto-approve-btn.toggled::after { content:''; position:absolute; bottom:2px; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:50%; background:#89d185; }
        .auto-badge { display:inline-block; background:rgba(137,209,133,0.2); color:#89d185; font-size:9px; font-weight:700; padding:1px 5px; border-radius:3px; margin-left:8px; letter-spacing:0.5px; vertical-align:middle; }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="header-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0a8 8 0 1 0 8 8 8 8 0 0 0-8-8zm0 14.5a6.5 6.5 0 1 1 6.5-6.5 6.5 6.5 0 0 1-6.5 6.5z"/>
                    <circle cx="8" cy="8" r="3.5"/>
                </svg>
            </div>
            <div class="header-title">Aether</div>
        </div>
        <div class="header-right">
            <button class="icon-btn auto-approve-btn" aria-label="Auto-Approve" id="auto-approve-btn" title="Auto-Approve OFF — click to enable">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.56 7.56L4.5 8.62 7.44 11.56 13.5 5.5 12.44 4.44 7.44 9.44zM8 1a7 7 0 100 14A7 7 0 008 1zm0 12.6A5.6 5.6 0 1113.6 8 5.61 5.61 0 018 13.6z"/></svg>
            </button>
            <button class="icon-btn" aria-label="History" id="history-btn" title="Chat History">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0zM8 3v5l3.15 1.88.7-1.18L9 7.25V3H8z"/></svg>
            </button>
            <button class="icon-btn" aria-label="New Chat" id="new-chat-btn" title="New Chat">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 14A6 6 0 108 2a6 6 0 000 12zm.5-9v2.5H11v1H8.5V11h-1V8.5H5v-1h2.5V5h1z"/></svg>
            </button>
            <button class="icon-btn" aria-label="Settings" id="settings-btn" title="Settings">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 13.5a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM8 12a4 4 0 100-8 4 4 0 000 8zm1-5v2H7V7h2z"/></svg>
            </button>
        </div>
    </div>

    <div class="model-container">
        <span class="model-label">Model</span>
        <div class="model-select-wrapper">
            <select id="model-select"></select>
        </div>
    </div>

    <div id="messages"></div>

    <div class="input-area">
        <div class="input-container" id="input-container">
            <textarea id="chat-input" placeholder="Ask Aether..." rows="1"></textarea>
            <div class="action-buttons">
                <div id="clear-input" class="icon-btn" title="Clear input">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/></svg>
                </div>
                <div id="send-btn" class="icon-btn send-btn" title="Send message">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>
                </div>
                <div id="stop-btn" class="icon-btn stop-btn" title="Stop generation">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h12v12H6z"/>
                    </svg>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
