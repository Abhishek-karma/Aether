"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const prompt_1 = require("../agent/prompt");
const nvidia_1 = require("../llm/nvidia");
const ollama_1 = require("../llm/ollama");
const edit_1 = require("../tools/edit");
const file_1 = require("../tools/file");
const terminal_1 = require("../tools/terminal");
const workspace_1 = require("../tools/workspace");
const HISTORY_KEY = 'aether.chatHistory';
const MAX_STORED_MESSAGES = 100;
const MODEL_CACHE_MS = 10000;
const NVIDIA_MODEL_PREFIX = 'nvidia::';
const OLLAMA_MODEL_PREFIX = 'ollama::';
const NVIDIA_MODEL_IDS = new Set(nvidia_1.AVAILABLE_MODELS.map(model => model.id));
class ChatViewProvider {
    _extensionUri;
    extensionContext;
    _view;
    nvidiaClient;
    ollamaClient;
    messages = [];
    lastModel;
    actionCounter = 0;
    modelCache;
    modelLoad;
    constructor(_extensionUri, extensionContext) {
        this._extensionUri = _extensionUri;
        this.extensionContext = extensionContext;
        this.nvidiaClient = new nvidia_1.NvidiaClient();
        this.ollamaClient = new ollama_1.OllamaClient();
        this.messages = this.loadHistory();
    }
    async resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this.postHistory();
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.text, data.model);
                    break;
                case 'clearChat':
                    this.messages = [];
                    await this.saveHistory();
                    break;
                case 'getHistory':
                    this.postHistory();
                    break;
                case 'getModels': {
                    const { models, defaultModel } = await this.listAvailableModels();
                    this._view?.webview.postMessage({ type: 'modelsLoaded', models, defaultModel });
                    break;
                }
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'aether');
                    break;
                case 'previewAction':
                    await (0, edit_1.showDiff)(data.original, data.content, data.fullPath);
                    break;
                case 'acceptAction':
                    await this.executeFileAction(data.actionId, data.actionType, data.file, data.content);
                    break;
                case 'acceptCommand':
                    await this.executeApprovedCommand(data.actionId, data.command, data.model);
                    break;
            }
        });
    }
    async submitExternalMessage(text, model) {
        if (!this._view) {
            await vscode.commands.executeCommand('aetherChatView.focus');
        }
        this._view?.webview.postMessage({ type: 'addExternalUserMessage', text });
        await this.handleUserMessage(text, model);
    }
    async submitInlineRequest(query, selectedCode, fileName) {
        const text = `Inline request for ${fileName}:
${query}

Selected code:
\`\`\`
${selectedCode}
\`\`\`

If an edit is needed, return the full updated content for ${fileName}.`;
        await this.submitExternalMessage(text);
    }
    async clearHistory() {
        this.messages = [];
        await this.saveHistory();
        this._view?.webview.postMessage({ type: 'historyLoaded', messages: [] });
    }
    async handleUserMessage(text, model) {
        if (!this._view) {
            return;
        }
        this.messages.push({ role: 'user', content: text });
        await this.saveHistory();
        await this.runAssistantTurn(text, model);
    }
    async runAssistantTurn(contextHint, model, isCorrectionRetry = false) {
        if (!this._view) {
            return;
        }
        this._view.webview.postMessage({ type: 'startStream' });
        try {
            let fullResponse = '';
            const selectedModel = this.resolveModel(model);
            this.lastModel = selectedModel.value;
            const workspaceContext = await (0, workspace_1.collectWorkspaceContext)(contextHint);
            const requestMessages = [
                {
                    role: 'system',
                    content: (0, prompt_1.generateSystemPrompt)(workspaceContext.snippets, workspaceContext.workspaceRoot || 'No workspace opened')
                },
                ...this.messages.slice(-12)
            ];
            const stream = selectedModel.provider === 'ollama'
                ? this.ollamaClient.chatStream(requestMessages, { model: selectedModel.model })
                : this.nvidiaClient.chatStream(requestMessages, { model: selectedModel.model });
            for await (const chunk of stream) {
                fullResponse += chunk;
                this._view.webview.postMessage({ type: 'streamChunk', chunk });
            }
            this.messages.push({ role: 'assistant', content: fullResponse });
            await this.saveHistory();
            this._view.webview.postMessage({ type: 'endStream' });
            const actionCount = await this.processAgentActions(fullResponse, contextHint);
            if (actionCount === 0 && this.shouldRequireFileActions(contextHint) && !isCorrectionRetry) {
                await this.retryAsAgentAction(contextHint, selectedModel.value);
            }
        }
        catch (error) {
            this._view.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'An error occurred connecting to the selected model provider'
            });
        }
    }
    async continueAfterToolResult(summary, model) {
        this.messages.push({
            role: 'user',
            content: `Tool result:\n${summary}\n\nContinue based on this result.`
        });
        await this.saveHistory();
        await this.runAssistantTurn(summary, model || this.lastModel);
    }
    loadHistory() {
        const saved = this.extensionContext.workspaceState.get(HISTORY_KEY, []);
        return saved.filter(message => (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string');
    }
    async saveHistory() {
        const trimmed = this.messages.slice(-MAX_STORED_MESSAGES);
        this.messages = trimmed;
        await this.extensionContext.workspaceState.update(HISTORY_KEY, trimmed);
    }
    postHistory() {
        this._view?.webview.postMessage({
            type: 'historyLoaded',
            messages: this.messages
        });
    }
    async listAvailableModels() {
        const now = Date.now();
        if (this.modelCache && this.modelCache.expiresAt > now) {
            return this.modelCache;
        }
        if (!this.modelLoad) {
            this.modelLoad = this.loadAvailableModels().finally(() => {
                this.modelLoad = undefined;
            });
        }
        return this.modelLoad;
    }
    async loadAvailableModels() {
        const nvidiaModels = this.nvidiaClient.listModels().map(model => ({
            id: `${NVIDIA_MODEL_PREFIX}${model.id}`,
            label: model.label,
            provider: 'nvidia'
        }));
        const localModelNames = await this.ollamaClient.listModels();
        const localModels = localModelNames.map(name => ({
            id: `${OLLAMA_MODEL_PREFIX}${name}`,
            label: `Local Llama/Ollama: ${name}`,
            provider: 'ollama'
        }));
        const models = [...localModels, ...nvidiaModels];
        const defaultModel = this.getDefaultModelValue(localModelNames);
        this.modelCache = {
            expiresAt: Date.now() + MODEL_CACHE_MS,
            models,
            defaultModel
        };
        return this.modelCache;
    }
    getDefaultModelValue(localModels) {
        const configuredLocal = vscode.workspace.getConfiguration('aether').get('defaultModel', '').trim();
        if (configuredLocal && localModels.includes(configuredLocal)) {
            return `${OLLAMA_MODEL_PREFIX}${configuredLocal}`;
        }
        const nvidiaApiKey = vscode.workspace.getConfiguration('aether').get('nvidiaApiKey', '').trim();
        if (!nvidiaApiKey && localModels.length > 0) {
            return `${OLLAMA_MODEL_PREFIX}${localModels[0]}`;
        }
        return `${NVIDIA_MODEL_PREFIX}${this.nvidiaClient.getDefaultModel()}`;
    }
    resolveModel(model) {
        if (model?.startsWith(OLLAMA_MODEL_PREFIX)) {
            const modelName = model.slice(OLLAMA_MODEL_PREFIX.length);
            if (modelName) {
                return { provider: 'ollama', model: modelName, value: model };
            }
        }
        if (model?.startsWith(NVIDIA_MODEL_PREFIX)) {
            const modelName = model.slice(NVIDIA_MODEL_PREFIX.length);
            if (NVIDIA_MODEL_IDS.has(modelName)) {
                return { provider: 'nvidia', model: modelName, value: model };
            }
        }
        if (model && NVIDIA_MODEL_IDS.has(model)) {
            return { provider: 'nvidia', model, value: `${NVIDIA_MODEL_PREFIX}${model}` };
        }
        const fallback = this.nvidiaClient.getDefaultModel();
        return { provider: 'nvidia', model: fallback, value: `${NVIDIA_MODEL_PREFIX}${fallback}` };
    }
    async retryAsAgentAction(originalRequest, model) {
        const correction = `Your previous response did not contain any Aether tool actions. This is an implementation task, so do not explain or give instructions. Produce the next required create/edit/read_file/run_command action now for this user request:\n\n${originalRequest}`;
        const actionId = this.nextActionId();
        this._view?.webview.postMessage({
            type: 'showToolCard',
            actionId,
            tool: 'Agent Correction',
            title: 'Requesting file action',
            status: 'running'
        });
        this.messages.push({ role: 'user', content: correction });
        await this.saveHistory();
        await this.runAssistantTurn(originalRequest, model, true);
        this._view?.webview.postMessage({
            type: 'updateToolCard',
            actionId,
            status: 'done',
            output: 'Correction request sent.'
        });
    }
    async processAgentActions(response, contextHint) {
        try {
            const actions = this.extractActions(response);
            if (actions.length === 0) {
                const fallback = this.createActiveEditorFallbackAction(response, contextHint);
                if (fallback) {
                    actions.push(fallback);
                }
            }
            for (const action of actions) {
                if (action.type === 'read_file') {
                    await this.executeReadFileAction(action);
                    continue;
                }
                if (action.type === 'run_command') {
                    this.showCommandAction(action);
                    continue;
                }
                await this.showFileAction(action);
            }
            return actions.length;
        }
        catch (error) {
            console.error('Error processing agent actions:', error);
            this._view?.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Could not process proposed file actions.'
            });
            return 0;
        }
    }
    async showFileAction(action) {
        const fullPath = (0, file_1.resolveSafeFilePath)(action.file);
        const actionType = action.type === 'create' && await (0, file_1.fileExists)(fullPath) ? 'edit' : action.type;
        let original = '';
        if (actionType === 'edit') {
            try {
                original = await (0, file_1.readFile)(fullPath);
            }
            catch {
                original = '';
            }
        }
        this._view?.webview.postMessage({
            type: 'showActionCard',
            actionId: this.nextActionId(),
            actionType,
            file: action.file,
            fullPath,
            content: action.content,
            original
        });
    }
    async executeFileAction(actionId, actionType, file, content) {
        try {
            const fullPath = (0, file_1.resolveSafeFilePath)(file);
            const result = actionType === 'create'
                ? await (0, file_1.createFile)(fullPath, content)
                : await (0, edit_1.applyEdit)(fullPath, content);
            this._view?.webview.postMessage({
                type: 'fileActionResult',
                actionId,
                ok: result.ok,
                message: result.message
            });
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'fileActionResult',
                actionId,
                ok: false,
                message: error instanceof Error ? error.message : 'Could not apply file action.'
            });
        }
    }
    async executeReadFileAction(action) {
        const actionId = this.nextActionId();
        this._view?.webview.postMessage({
            type: 'showToolCard',
            actionId,
            tool: 'Read File',
            title: action.file,
            status: 'running'
        });
        try {
            const fullPath = (0, file_1.resolveSafeFilePath)(action.file);
            const content = await (0, file_1.readFile)(fullPath);
            const summary = `Read file: ${action.file}\n\`\`\`\n${this.trimToolContent(content)}\n\`\`\``;
            this._view?.webview.postMessage({
                type: 'updateToolCard',
                actionId,
                status: 'done',
                output: content
            });
            await this.continueAfterToolResult(summary);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Could not read file.';
            this._view?.webview.postMessage({
                type: 'updateToolCard',
                actionId,
                status: 'error',
                output: message
            });
        }
    }
    showCommandAction(action) {
        this._view?.webview.postMessage({
            type: 'showCommandCard',
            actionId: this.nextActionId(),
            command: action.command,
            reason: action.reason || 'Aether wants to run this command.'
        });
    }
    async executeApprovedCommand(actionId, command, model) {
        this._view?.webview.postMessage({
            type: 'updateToolCard',
            actionId,
            status: 'running',
            output: ''
        });
        const result = await (0, terminal_1.runCommand)(command);
        const output = [
            result.stdout ? `stdout:\n${result.stdout}` : '',
            result.stderr ? `stderr:\n${result.stderr}` : ''
        ].filter(Boolean).join('\n\n') || '(no output)';
        this._view?.webview.postMessage({
            type: 'updateToolCard',
            actionId,
            status: result.exitCode === 0 ? 'done' : 'error',
            output: `exit code: ${result.exitCode}\n\n${output}`
        });
        await this.continueAfterToolResult(`Command: ${command}\nExit code: ${result.exitCode}\n${output}`, model);
    }
    extractActions(response) {
        const actions = [
            ...this.extractFencedFileActions(response),
            ...this.extractMarkdownFileActions(response)
        ];
        for (const candidate of this.extractJsonCandidates(response)) {
            try {
                const parsed = JSON.parse(candidate);
                const parsedActions = Array.isArray(parsed.actions) ? parsed.actions : [parsed];
                for (const action of parsedActions) {
                    if ((action.type === 'create' || action.type === 'edit') &&
                        typeof action.file === 'string' &&
                        typeof action.content === 'string') {
                        actions.push(action);
                    }
                    else if (action.type === 'read_file' &&
                        typeof action.file === 'string') {
                        actions.push(action);
                    }
                    else if (action.type === 'run_command' &&
                        typeof action.command === 'string') {
                        actions.push(action);
                    }
                }
            }
            catch {
                // Ignore prose or malformed JSON fragments.
            }
        }
        return actions;
    }
    shouldRequireFileActions(request) {
        return /\b(create|build|implement|add|fix|write|update|modify|change|refactor|delete|remove|make)\b/i.test(request);
    }
    createActiveEditorFallbackAction(response, request) {
        if (!this.shouldRequireFileActions(request)) {
            return undefined;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.isUntitled) {
            return undefined;
        }
        const code = this.extractFirstPlainCodeBlock(response);
        if (!code) {
            return undefined;
        }
        const document = editor.document;
        const relativeFile = vscode.workspace.asRelativePath(document.uri);
        const original = document.getText();
        const selection = editor.selection;
        const content = selection.isEmpty
            ? this.insertAtPosition(original, document.offsetAt(selection.active), code)
            : this.replaceRange(original, document.offsetAt(selection.start), document.offsetAt(selection.end), code);
        return {
            type: 'edit',
            file: relativeFile,
            content
        };
    }
    extractFirstPlainCodeBlock(response) {
        const blocks = response.matchAll(/```(?!aether-|json)(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)```/g);
        for (const block of blocks) {
            const content = block[1].replace(/\s+$/, '');
            if (content.length > 0 && !content.trim().startsWith('{')) {
                return content;
            }
        }
        return undefined;
    }
    replaceRange(original, start, end, replacement) {
        return `${original.slice(0, start)}${replacement}${original.slice(end)}`;
    }
    insertAtPosition(original, offset, insertion) {
        const prefix = original.slice(0, offset);
        const suffix = original.slice(offset);
        const before = prefix.endsWith('\n') || prefix.length === 0 ? '' : '\n';
        const after = suffix.startsWith('\n') || suffix.length === 0 ? '' : '\n';
        return `${prefix}${before}${insertion}${after}${suffix}`;
    }
    extractFencedFileActions(response) {
        const actions = [];
        const blocks = response.matchAll(/```aether-(create|edit)\s+(?:path|file)=([^\n]+)\n([\s\S]*?)```/g);
        for (const block of blocks) {
            const type = block[1];
            const file = block[2].trim().replace(/^["']|["']$/g, '');
            const content = block[3].replace(/\s+$/, '');
            if (file && content.length > 0) {
                actions.push({ type, file, content });
            }
        }
        return actions;
    }
    extractMarkdownFileActions(response) {
        const actions = [];
        const blocks = response.matchAll(/(?:^|\n)(?:#{1,4}\s*)?(?:(File|Create|Edit):)?\s*`?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)`?\s*:?\s*\n```[A-Za-z0-9_-]*\n([\s\S]*?)```/g);
        for (const block of blocks) {
            const mode = block[1]?.toLowerCase();
            const file = block[2].trim().replace(/\\/g, '/');
            const content = block[3].replace(/\s+$/, '');
            if (!this.looksLikeProjectFile(file) || content.length === 0) {
                continue;
            }
            actions.push({
                type: mode === 'edit' ? 'edit' : 'create',
                file,
                content
            });
        }
        return actions;
    }
    looksLikeProjectFile(file) {
        if (file.startsWith('.') || file.includes('..') || file.includes('://')) {
            return false;
        }
        return /^[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/.test(file);
    }
    extractJsonCandidates(response) {
        const candidates = [];
        const fencedBlocks = response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g);
        for (const match of fencedBlocks) {
            candidates.push(match[1].trim());
        }
        candidates.push(...this.extractBalancedJsonObjects(response));
        return candidates;
    }
    extractBalancedJsonObjects(text) {
        const objects = [];
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                }
                else if (char === '\\') {
                    escaped = true;
                }
                else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
                continue;
            }
            if (char === '{') {
                if (depth === 0) {
                    start = index;
                }
                depth += 1;
                continue;
            }
            if (char === '}') {
                depth -= 1;
                if (depth === 0 && start !== -1) {
                    objects.push(text.slice(start, index + 1));
                    start = -1;
                }
            }
        }
        return objects;
    }
    nextActionId() {
        this.actionCounter += 1;
        return `aether-action-${Date.now()}-${this.actionCounter}`;
    }
    trimToolContent(content) {
        const maxChars = 16000;
        if (content.length <= maxChars) {
            return content;
        }
        return `${content.slice(0, maxChars)}\n... [truncated]`;
    }
    _getHtmlForWebview(webview) {
        const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.min.js'));
        const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aether Chat</title>
    <script type="module" src="${toolkitUri}"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        body { padding: 10px; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); }
        .chat-container { display: flex; flex-direction: column; height: calc(100vh - 20px); }
        .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .toolbar vscode-dropdown { flex: 1; min-width: 0; }
        .messages { flex-grow: 1; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
        .message { padding: 8px; border-radius: 4px; line-height: 1.4; position: relative; }
        .user-message { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; max-width: 80%; }
        .assistant-message { background-color: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; max-width: 90%; }
        pre {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 24px 12px 12px 12px;
            overflow-x: auto;
            position: relative;
            margin: 8px 0;
        }
        pre::before {
            content: 'CODE';
            position: absolute;
            top: 4px;
            left: 8px;
            font-size: 10px;
            font-weight: bold;
            opacity: 0.5;
            letter-spacing: 1px;
        }
        code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
        .action-card {
            background-color: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 12px;
            margin-top: 10px;
            border-radius: 6px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .action-header { font-weight: bold; font-size: 0.9em; display: flex; align-items: center; gap: 6px; }
        .action-file { font-family: var(--vscode-editor-font-family); font-size: 0.85em; opacity: 0.8; }
        .action-buttons { display: flex; gap: 8px; }
        .tool-card {
            background-color: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .tool-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tool-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tool-subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .tool-output {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            max-height: 240px;
            overflow: auto;
            padding: 8px;
            white-space: pre-wrap;
        }
        .status-pill {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 999px;
            color: var(--vscode-descriptionForeground);
            flex: 0 0 auto;
            font-size: 11px;
            padding: 2px 7px;
        }
        .status-running { color: var(--vscode-progressBar-background); }
        .status-done { color: var(--vscode-testing-iconPassed); }
        .status-error { color: var(--vscode-testing-iconFailed); }
        .typing {
            align-items: center;
            display: inline-flex;
            gap: 4px;
            min-height: 18px;
        }
        .typing span {
            animation: pulse 1s infinite ease-in-out;
            background: var(--vscode-descriptionForeground);
            border-radius: 50%;
            display: inline-block;
            height: 6px;
            width: 6px;
        }
        .typing span:nth-child(2) { animation-delay: 0.15s; }
        .typing span:nth-child(3) { animation-delay: 0.3s; }
        .spinner {
            animation: spin 0.8s linear infinite;
            border: 2px solid var(--vscode-panel-border);
            border-top-color: var(--vscode-progressBar-background);
            border-radius: 50%;
            height: 12px;
            width: 12px;
        }
        @keyframes pulse {
            0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
            40% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .input-container { display: flex; flex-direction: column; gap: 8px; padding-bottom: 20px; }
        .error { color: var(--vscode-errorForeground); margin-top: 5px; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="toolbar">
            <img src="${iconUri}" alt="Aether" style="height: 24px; width: 24px; flex-shrink:0;" />
            <vscode-dropdown id="modelSelect" style="flex:1;min-width:0;">
                <vscode-option>Loading models...</vscode-option>
            </vscode-dropdown>
            <vscode-button id="settingsBtn" appearance="icon" title="Open Aether settings" aria-label="Settings">&#9881;</vscode-button>
            <vscode-button id="clearBtn" appearance="secondary">Clear</vscode-button>
        </div>

        <div class="messages" id="messages">
            <div class="message assistant-message">Hello! I am Aether. How can I help you code today?</div>
        </div>

        <div class="input-container">
            <vscode-text-area id="userInput" placeholder="Ask Aether..." rows="3" resize="vertical"></vscode-text-area>
            <vscode-button id="sendBtn">Send</vscode-button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const userInput = document.getElementById('userInput');
        const sendBtn = document.getElementById('sendBtn');
        const clearBtn = document.getElementById('clearBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const modelSelect = document.getElementById('modelSelect');

        let currentAssistantMessage = null;
        let isStreaming = false;
        const toolCards = new Map();

        vscode.postMessage({ type: 'getModels' });
        vscode.postMessage({ type: 'getHistory' });

        sendBtn.addEventListener('click', sendMessage);
        settingsBtn.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
        userInput.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                sendMessage();
            }
        });
        clearBtn.addEventListener('click', () => {
            messagesContainer.innerHTML = '<div class="message assistant-message">Chat cleared. What should we build next?</div>';
            vscode.postMessage({ type: 'clearChat' });
        });

        function sendMessage() {
            const text = userInput.value.trim();
            const model = modelSelect.value;
            if (text && !isStreaming) {
                appendUserMessage(text);
                userInput.value = '';
                vscode.postMessage({ type: 'sendMessage', text, model });
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }

        function appendUserMessage(text) {
            appendMessage('user', text);
        }

        function appendAssistantMessage(text) {
            const msgDiv = appendMessage('assistant', '');
            msgDiv.innerHTML = marked.parse(escapeHtml(text));
        }

        function appendMessage(role, text) {
            const msgDiv = document.createElement('div');
            msgDiv.className = role === 'user' ? 'message user-message' : 'message assistant-message';
            msgDiv.textContent = text;
            messagesContainer.appendChild(msgDiv);
            return msgDiv;
        }

        function escapeHtml(value) {
            return value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'historyLoaded':
                    if (message.messages.length > 0) {
                        messagesContainer.innerHTML = '';
                        message.messages.forEach(historyMessage => {
                            if (historyMessage.role === 'user') {
                                appendUserMessage(historyMessage.content);
                            } else {
                                appendAssistantMessage(historyMessage.content);
                            }
                        });
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                    break;
                case 'addExternalUserMessage':
                    appendUserMessage(message.text);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    break;
                case 'modelsLoaded':
                    modelSelect.innerHTML = '';
                    if (!message.models || message.models.length === 0) {
                        const opt = document.createElement('vscode-option');
                        opt.textContent = 'No models available';
                        modelSelect.appendChild(opt);
                    } else {
                        message.models.forEach(m => {
                            const opt = document.createElement('vscode-option');
                            opt.value = m.id;
                            opt.textContent = m.label;
                            if (m.id === message.defaultModel) {
                                opt.setAttribute('selected', 'true');
                            }
                            modelSelect.appendChild(opt);
                        });
                        // Sync the dropdown's displayed value to the default
                        if (message.defaultModel) {
                            modelSelect.value = message.defaultModel;
                        }
                    }
                    break;
                case 'startStream':
                    isStreaming = true;
                    sendBtn.disabled = true;
                    currentAssistantMessage = document.createElement('div');
                    currentAssistantMessage.className = 'message assistant-message';
                    currentAssistantMessage.innerHTML = '<div class="typing" aria-label="Aether is thinking"><span></span><span></span><span></span></div>';
                    messagesContainer.appendChild(currentAssistantMessage);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    break;
                case 'streamChunk':
                    if (currentAssistantMessage) {
                        currentAssistantMessage.setAttribute('data-raw', (currentAssistantMessage.getAttribute('data-raw') || '') + message.chunk);
                        currentAssistantMessage.innerHTML = marked.parse(escapeHtml(currentAssistantMessage.getAttribute('data-raw')));
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                    break;
                case 'endStream':
                    isStreaming = false;
                    sendBtn.disabled = false;
                    currentAssistantMessage = null;
                    break;
                case 'showActionCard':
                    showActionCard(message);
                    break;
                case 'showToolCard':
                    showToolCard(message);
                    break;
                case 'showCommandCard':
                    showCommandCard(message);
                    break;
                case 'updateToolCard':
                    updateToolCard(message);
                    break;
                case 'fileActionResult':
                    updateFileActionCard(message);
                    break;
                case 'error':
                    isStreaming = false;
                    sendBtn.disabled = false;
                    appendError(message.message);
                    break;
            }
        });

        function showActionCard(message) {
            const card = document.createElement('div');
            card.className = 'action-card';
            card.dataset.actionId = message.actionId;

            const header = document.createElement('div');
            header.className = 'action-header';
            header.textContent = message.actionType === 'create' ? 'Create File' : 'Edit File';

            const file = document.createElement('div');
            file.className = 'action-file';
            file.textContent = message.file;

            const buttons = document.createElement('div');
            buttons.className = 'action-buttons';
            buttons.innerHTML =
                '<vscode-button appearance="primary" class="preview-btn">Preview</vscode-button>' +
                '<vscode-button appearance="primary" class="accept-btn">Accept</vscode-button>' +
                '<vscode-button appearance="secondary" class="reject-btn">Reject</vscode-button>';

            card.appendChild(header);
            card.appendChild(file);
            card.appendChild(buttons);
            messagesContainer.appendChild(card);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            const previewBtn = card.querySelector('.preview-btn');
            const acceptBtn = card.querySelector('.accept-btn');
            const rejectBtn = card.querySelector('.reject-btn');

            previewBtn.onclick = () => {
                vscode.postMessage({
                    type: 'previewAction',
                    original: message.original,
                    content: message.content,
                    fullPath: message.fullPath
                });
            };

            acceptBtn.onclick = () => {
                header.textContent = 'Applying...';
                acceptBtn.disabled = true;
                rejectBtn.disabled = true;
                vscode.postMessage({
                    type: 'acceptAction',
                    actionId: message.actionId,
                    actionType: message.actionType,
                    file: message.file,
                    content: message.content
                });
            };

            rejectBtn.onclick = () => {
                card.remove();
            };
        }

        function updateFileActionCard(message) {
            const card = document.querySelector('[data-action-id="' + message.actionId + '"]');
            if (!card) {
                return;
            }

            const header = card.querySelector('.action-header');
            const acceptBtn = card.querySelector('.accept-btn');
            const rejectBtn = card.querySelector('.reject-btn');

            if (message.ok) {
                card.style.opacity = '0.65';
                card.style.pointerEvents = 'none';
                header.textContent = 'Applied';
                return;
            }

            header.textContent = 'Apply failed';
            acceptBtn.disabled = false;
            rejectBtn.disabled = false;
            appendError(message.message);
        }

        function showToolCard(message) {
            const card = createToolCard(message.actionId, message.tool, message.title, message.status);
            toolCards.set(message.actionId, card);
            messagesContainer.appendChild(card.root);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function showCommandCard(message) {
            const card = createToolCard(message.actionId, 'Terminal Command', message.command, 'pending');
            card.subtitle.textContent = message.reason;

            const buttons = document.createElement('div');
            buttons.className = 'action-buttons';
            buttons.innerHTML =
                '<vscode-button appearance="primary" class="accept-command-btn">Run</vscode-button>' +
                '<vscode-button appearance="secondary" class="reject-command-btn">Skip</vscode-button>';
            card.root.appendChild(buttons);

            card.root.querySelector('.accept-command-btn').onclick = () => {
                buttons.remove();
                updateToolCard({ actionId: message.actionId, status: 'running', output: '' });
                vscode.postMessage({
                    type: 'acceptCommand',
                    actionId: message.actionId,
                    command: message.command,
                    model: modelSelect.value
                });
            };

            card.root.querySelector('.reject-command-btn').onclick = () => {
                updateToolCard({ actionId: message.actionId, status: 'error', output: 'Skipped by user.' });
                buttons.remove();
            };

            toolCards.set(message.actionId, card);
            messagesContainer.appendChild(card.root);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function createToolCard(actionId, tool, title, status) {
            const root = document.createElement('div');
            root.className = 'tool-card';
            root.dataset.actionId = actionId;

            const row = document.createElement('div');
            row.className = 'tool-row';

            const titleWrap = document.createElement('div');
            titleWrap.style.minWidth = '0';

            const heading = document.createElement('div');
            heading.className = 'tool-title';
            heading.textContent = tool + ': ' + title;

            const subtitle = document.createElement('div');
            subtitle.className = 'tool-subtitle';
            subtitle.textContent = '';

            const statusPill = document.createElement('div');
            statusPill.className = 'status-pill';

            titleWrap.appendChild(heading);
            titleWrap.appendChild(subtitle);
            row.appendChild(titleWrap);
            row.appendChild(statusPill);
            root.appendChild(row);

            const output = document.createElement('div');
            output.className = 'tool-output';
            output.style.display = 'none';
            root.appendChild(output);

            const card = { root, statusPill, output, subtitle };
            setToolStatus(card, status);
            return card;
        }

        function updateToolCard(message) {
            const card = toolCards.get(message.actionId);
            if (!card) {
                return;
            }

            setToolStatus(card, message.status);
            if (typeof message.output === 'string' && message.output.length > 0) {
                card.output.textContent = message.output;
                card.output.style.display = 'block';
            }
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function setToolStatus(card, status) {
            card.statusPill.className = 'status-pill status-' + status;
            if (status === 'running') {
                card.statusPill.innerHTML = '<span class="spinner"></span>';
                card.statusPill.style.border = '0';
            } else {
                card.statusPill.style.border = '';
                card.statusPill.textContent = status === 'done' ? 'Done' : status === 'error' ? 'Needs attention' : 'Awaiting approval';
            }
        }

        function appendError(text) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = text;
            messagesContainer.appendChild(errorDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    </script>
</body>
</html>`;
    }
}
exports.ChatViewProvider = ChatViewProvider;
//# sourceMappingURL=chatView.js.map