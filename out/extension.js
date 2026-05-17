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
const Agent_1 = require("./agent/Agent");
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
        if (chatHistory.activeSession.messages.length > 0) {
            await chatHistory.createSession();
        }
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
        const agent = new Agent_1.Agent(modelRouter, chatHistory, chatViewProvider, contextEngine);
        try {
            await vscode.commands.executeCommand(`${chatView_1.ChatViewProvider.viewType}.focus`);
            await agent.run(text, modelId || '', autoApproveEnabled);
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
        if (chatHistory.activeSession.messages.length > 0) {
            await chatHistory.createSession();
        }
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: [] });
    });
    const getHistoryListCommand = vscode.commands.registerCommand('aether.getHistoryList', () => {
        chatViewProvider.postMessage({
            type: 'historyListLoaded',
            sessions: chatHistory.sessions,
            activeId: chatHistory.activeSession.id
        });
    });
    const loadSessionCommand = vscode.commands.registerCommand('aether.loadSession', async (sessionId) => {
        await chatHistory.selectSession(sessionId);
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: chatHistory.activeSession.messages });
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
    context.subscriptions.push(startChatCommand, newTaskCommand, stopGenerationCommand, toggleAutoApproveCommand, sendMessageCommand, acceptActionCommand, previewActionCommand, acceptCommandCommand, clearHistoryCommand, getHistoryListCommand, loadSessionCommand, inlineChatCommand);
}
function deactivate() {
    // Cleanup if needed
}
//# sourceMappingURL=extension.js.map