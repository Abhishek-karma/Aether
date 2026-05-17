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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const chatView_1 = require("./ui/chatView");
const chatHistory_1 = require("./ui/chatHistory");
const contextEngine_1 = require("./agent/contextEngine");
const modelRouter_1 = require("./llm/modelRouter");
const actions_1 = require("./agent/actions");
const edit_1 = require("./tools/edit");
const file_1 = require("./tools/file");
const terminal_1 = require("./tools/terminal");
const logger_1 = require("./utils/logger");
/** Global auto-approve state — when true, file actions are applied without user confirmation. */
let autoApproveEnabled = false;
function activate(context) {
    // Initialize shared output channel
    const outputChannel = (0, logger_1.getOutputChannel)();
    context.subscriptions.push(outputChannel);
    (0, logger_1.logInfo)('Aether is now active!');
    const chatHistory = new chatHistory_1.ChatHistoryStore(context);
    const contextEngine = new contextEngine_1.ContextEngine();
    // Create ONE shared model router
    const modelRouter = new modelRouter_1.ModelRouter();
    // Register Webview Provider for the Sidebar Chat
    const chatViewProvider = new chatView_1.ChatViewProvider(context.extensionUri, context, modelRouter);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(chatView_1.ChatViewProvider.viewType, chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Command: Start Chat
    const startChatCommand = vscode.commands.registerCommand('aether.startChat', () => {
        vscode.commands.executeCommand(`${chatView_1.ChatViewProvider.viewType}.focus`);
    });
    const newTaskCommand = vscode.commands.registerCommand('aether.newTask', async () => {
        await chatHistory.clearActiveSession();
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: [] });
        await vscode.commands.executeCommand(`${chatView_1.ChatViewProvider.viewType}.focus`);
    });
    // Command: Stop Generation
    const stopGenerationCommand = vscode.commands.registerCommand('aether.stopGeneration', () => {
        modelRouter.abort();
    });
    // Command: Toggle Auto-Approve
    const toggleAutoApproveCommand = vscode.commands.registerCommand('aether.toggleAutoApprove', () => {
        autoApproveEnabled = !autoApproveEnabled;
        (0, logger_1.logInfo)(`Auto-approve ${autoApproveEnabled ? 'ENABLED' : 'DISABLED'}`);
        chatViewProvider.postMessage({ type: 'autoApproveChanged', enabled: autoApproveEnabled });
    });
    // Command: Send Message
    const sendMessageCommand = vscode.commands.registerCommand('aether.sendMessage', async (text, modelId) => {
        const history = chatHistory.activeSession.messages;
        // Save user message
        await chatHistory.appendMessage({ role: 'user', content: text });
        // Prepare for streaming
        chatViewProvider.postMessage({ type: 'startStream' });
        const MAX_CONTINUATION_RETRIES = 2;
        const NUDGE_MESSAGE = 'You did not emit any tool action blocks in your last response. You MUST respond with ```aether-create or ```aether-edit fenced blocks containing the full file contents. Do it now — emit ALL the file actions needed to complete the task. No more explanations.';
        try {
            const selectedModel = await modelRouter.resolve(modelId);
            let retryCount = 0;
            let allActions = [];
            // Agentic loop: stream -> extract actions -> retry if no actions found
            while (retryCount <= MAX_CONTINUATION_RETRIES) {
                const currentHistory = chatHistory.activeSession.messages;
                const requestMessages = await contextEngine.buildRequestMessages(retryCount === 0 ? text : NUDGE_MESSAGE, currentHistory.slice(0, -1) // exclude the nudge itself from duplication
                );
                let fullResponse = '';
                const stream = modelRouter.chatStream(requestMessages, selectedModel);
                for await (const chunk of stream) {
                    fullResponse += chunk;
                    chatViewProvider.postMessage({ type: 'streamChunk', chunk });
                }
                // If the response is completely empty, it was likely aborted immediately.
                if (!fullResponse.trim()) {
                    chatViewProvider.postMessage({ type: 'endStream' });
                    return;
                }
                // Save assistant message
                await chatHistory.appendMessage({ role: 'assistant', content: fullResponse });
                // Detect actions from this response
                const actions = (0, actions_1.extractActions)(fullResponse);
                allActions.push(...actions);
                if (actions.length > 0) {
                    // We got actions — break out of the retry loop
                    break;
                }
                // No actions found — check if the request even needed actions
                if (!(0, actions_1.shouldRequireFileActions)(text)) {
                    // Pure question/explanation — no retry needed
                    break;
                }
                // Actions were expected but not found — auto-continue
                retryCount++;
                if (retryCount <= MAX_CONTINUATION_RETRIES) {
                    (0, logger_1.logWarn)(`No actions found in response, auto-continuing (attempt ${retryCount}/${MAX_CONTINUATION_RETRIES})`);
                    // Show a subtle indicator in chat that we're nudging the model
                    chatViewProvider.postMessage({ type: 'streamChunk', chunk: '\n\n---\n*Generating code...*\n\n' });
                    // Save the nudge as a user message in history so the model sees it
                    await chatHistory.appendMessage({ role: 'user', content: NUDGE_MESSAGE });
                }
            }
            chatViewProvider.postMessage({ type: 'endStream' });
            // Process all collected actions
            for (const action of allActions) {
                if (action.type === 'create' || action.type === 'edit') {
                    const fullPath = (0, file_1.resolveSafeFilePath)(action.file);
                    if (autoApproveEnabled) {
                        // Auto-apply: execute immediately, show a minimal status card
                        const actionId = Math.random().toString(36).slice(2);
                        chatViewProvider.postMessage({
                            type: 'showActionCard',
                            actionId,
                            actionType: action.type,
                            file: action.file,
                            content: action.content,
                            original: '',
                            fullPath,
                            autoApplied: true
                        });
                        let result;
                        if (action.type === 'create') {
                            result = await (0, file_1.createFile)(fullPath, action.content, true);
                        }
                        else {
                            result = await (0, edit_1.applyEdit)(fullPath, action.content);
                        }
                        chatViewProvider.postMessage({
                            type: 'fileActionResult',
                            actionId,
                            ok: result.ok,
                            message: result.message
                        });
                        (0, logger_1.logInfo)(`Auto-applied ${action.type}: ${action.file} — ${result.ok ? 'OK' : 'FAILED'}`);
                    }
                    else {
                        // Manual mode: show interactive action card
                        let original = '';
                        if (action.type === 'edit') {
                            try {
                                original = await (0, file_1.readFile)(fullPath);
                            }
                            catch { /* ignore */ }
                        }
                        chatViewProvider.postMessage({
                            type: 'showActionCard',
                            actionId: Math.random().toString(36).slice(2),
                            actionType: action.type,
                            file: action.file,
                            content: action.content,
                            original,
                            fullPath
                        });
                    }
                }
                else if (action.type === 'run_command') {
                    if (autoApproveEnabled) {
                        // Auto-run commands too
                        const actionId = Math.random().toString(36).slice(2);
                        chatViewProvider.postMessage({
                            type: 'showCommandCard',
                            actionId,
                            command: action.command,
                            reason: action.reason || 'Auto-executed by Aether',
                            autoApplied: true
                        });
                        try {
                            const result = await (0, terminal_1.runCommand)(action.command);
                            chatViewProvider.postMessage({
                                type: 'updateToolCard',
                                actionId,
                                status: result.exitCode === 0 ? 'done' : 'error',
                                output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
                            });
                        }
                        catch (error) {
                            chatViewProvider.postMessage({
                                type: 'updateToolCard',
                                actionId,
                                status: 'error',
                                output: error.message
                            });
                        }
                    }
                    else {
                        chatViewProvider.postMessage({
                            type: 'showCommandCard',
                            actionId: Math.random().toString(36).slice(2),
                            command: action.command,
                            reason: action.reason || 'Requested by Aether'
                        });
                    }
                }
            }
        }
        catch (error) {
            (0, logger_1.logError)('Chat generation failed', error);
            chatViewProvider.postMessage({ type: 'error', message: error.message || 'An unknown error occurred' });
        }
    });
    // Command: Accept File Action (manual mode)
    const acceptActionCommand = vscode.commands.registerCommand('aether.acceptAction', async (data) => {
        const fullPath = (0, file_1.resolveSafeFilePath)(data.file);
        let result;
        if (data.actionType === 'create') {
            result = await (0, file_1.createFile)(fullPath, data.content);
        }
        else {
            result = await (0, edit_1.applyEdit)(fullPath, data.content);
        }
        chatViewProvider.postMessage({ type: 'fileActionResult', actionId: data.actionId, ok: result.ok, message: result.message });
    });
    // Command: Preview Action (Diff)
    const previewActionCommand = vscode.commands.registerCommand('aether.previewAction', async (data) => {
        await (0, edit_1.showDiff)(data.original || '', data.content, data.fullPath);
    });
    // Command: Accept Command (manual mode)
    const acceptCommandCommand = vscode.commands.registerCommand('aether.acceptCommand', async (data) => {
        try {
            const result = await (0, terminal_1.runCommand)(data.command);
            chatViewProvider.postMessage({
                type: 'updateToolCard',
                actionId: data.actionId,
                status: result.exitCode === 0 ? 'done' : 'error',
                output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
            });
            if (result.exitCode !== 0) {
                (0, logger_1.logWarn)(`Command failed, wait for user input. Exit code: ${result.exitCode}`);
            }
        }
        catch (error) {
            chatViewProvider.postMessage({ type: 'updateToolCard', actionId: data.actionId, status: 'error', output: error.message });
        }
    });
    const clearHistoryCommand = vscode.commands.registerCommand('aether.clearHistory', async () => {
        await chatHistory.clearActiveSession();
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: [] });
    });
    const showHistoryCommand = vscode.commands.registerCommand('aether.showHistory', async () => {
        const sessions = chatHistory.sessions;
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No chat history available.');
            return;
        }
        const items = sessions.map(s => ({
            label: s.title || new Date(s.updatedAt).toLocaleString(),
            description: s.messages.length > 0 ? s.messages[0].content.substring(0, 50) + '...' : 'Empty Session',
            session: s
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a previous chat session'
        });
        if (selected) {
            await chatHistory.selectSession(selected.session.id);
            chatViewProvider.postMessage({ type: 'historyLoaded', messages: selected.session.messages });
            await vscode.commands.executeCommand(`${chatView_1.ChatViewProvider.viewType}.focus`);
        }
    });
    // Command: Inline Chat
    const inlineChatCommand = vscode.commands.registerCommand('aether.inlineChat', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor to start inline chat.');
            return;
        }
        const selection = editor.document.getText(editor.selection);
        const query = await vscode.window.showInputBox({
            prompt: 'Ask Aether about the selected code...',
            placeHolder: 'e.g. Explain this function, Refactor to use async/await'
        });
        if (query) {
            await vscode.commands.executeCommand(`${chatView_1.ChatViewProvider.viewType}.focus`);
            await chatViewProvider.submitInlineRequest(query, selection || editor.document.getText(), vscode.workspace.asRelativePath(editor.document.uri));
        }
    });
    context.subscriptions.push(startChatCommand, newTaskCommand, stopGenerationCommand, toggleAutoApproveCommand, sendMessageCommand, acceptActionCommand, previewActionCommand, acceptCommandCommand, clearHistoryCommand, showHistoryCommand, inlineChatCommand);
}
function deactivate() {
    // Cleanup if needed
}
//# sourceMappingURL=extension.js.map