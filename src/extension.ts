import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatView';
import { ChatHistoryStore } from './ui/chatHistory';
import { ContextEngine } from './agent/contextEngine';
import { ModelRouter } from './llm/modelRouter';
import { extractActions, shouldRequireFileActions } from './agent/actions';
import { Agent } from './agent/Agent';
import { applyEdit, showDiff } from './tools/edit';
import { createFile, resolveSafeFilePath, readFile } from './tools/file';
import { runCommand } from './tools/terminal';
import { logInfo, logWarn, logError, getOutputChannel } from './utils/logger';

/** Global auto-approve state — when true, file actions are applied without user confirmation. */
let autoApproveEnabled = false;

export function activate(context: vscode.ExtensionContext) {
    // Initialize shared output channel
    const outputChannel = getOutputChannel();
    context.subscriptions.push(outputChannel);
    logInfo('Aether is now active!');

    const chatHistory = new ChatHistoryStore(context);
    const contextEngine = new ContextEngine();
    
    // Create ONE shared model router
    const modelRouter = new ModelRouter();

    // Register Webview Provider for the Sidebar Chat
    const chatViewProvider = new ChatViewProvider(context.extensionUri, context, modelRouter);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Command: Start Chat
    const startChatCommand = vscode.commands.registerCommand('aether.startChat', () => {
        vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    });

    const newTaskCommand = vscode.commands.registerCommand('aether.newTask', async () => {
        if (chatHistory.activeSession.messages.length > 0) {
            await chatHistory.createSession();
        }
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: [] });
        await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    });

    // Command: Stop Generation
    const stopGenerationCommand = vscode.commands.registerCommand('aether.stopGeneration', () => {
        modelRouter.abort();
    });

    // Command: Toggle Auto-Approve
    const toggleAutoApproveCommand = vscode.commands.registerCommand('aether.toggleAutoApprove', () => {
        autoApproveEnabled = !autoApproveEnabled;
        logInfo(`Auto-approve ${autoApproveEnabled ? 'ENABLED' : 'DISABLED'}`);
        chatViewProvider.postMessage({ type: 'autoApproveChanged', enabled: autoApproveEnabled });
    });

    // Command: Send Message
    const sendMessageCommand = vscode.commands.registerCommand('aether.sendMessage', async (text: string, modelId?: string) => {
        const agent = new Agent(modelRouter, chatHistory, chatViewProvider, contextEngine);

        try {
            await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
            await agent.run(text, modelId || '', autoApproveEnabled);
        } catch (error: any) {
            logError('Chat generation failed', error);
            chatViewProvider.postMessage({ type: 'error', message: error.message || 'An unknown error occurred' });
        }
    });

    // Command: Accept File Action (manual mode)
    const acceptActionCommand = vscode.commands.registerCommand('aether.acceptAction', async (data: any) => {
        const fullPath = resolveSafeFilePath(data.file);
        let result;
        if (data.actionType === 'create') {
            result = await createFile(fullPath, data.content);
        } else {
            result = await applyEdit(fullPath, data.content);
        }
        chatViewProvider.postMessage({ type: 'fileActionResult', actionId: data.actionId, ok: result.ok, message: result.message });
    });

    // Command: Preview Action (Diff)
    const previewActionCommand = vscode.commands.registerCommand('aether.previewAction', async (data: any) => {
        await showDiff(data.original || '', data.content, data.fullPath);
    });

    // Command: Accept Command (manual mode)
    const acceptCommandCommand = vscode.commands.registerCommand('aether.acceptCommand', async (data: any) => {
        try {
            const result = await runCommand(data.command);
            chatViewProvider.postMessage({
                type: 'updateToolCard',
                actionId: data.actionId,
                status: result.exitCode === 0 ? 'done' : 'error',
                output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
            });
            
            if (result.exitCode !== 0) {
                logWarn(`Command failed, wait for user input. Exit code: ${result.exitCode}`);
            }
        } catch (error: any) {
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

    const loadSessionCommand = vscode.commands.registerCommand('aether.loadSession', async (sessionId: string) => {
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
            await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
            await chatViewProvider.submitInlineRequest(
                query,
                selection || editor.document.getText(),
                vscode.workspace.asRelativePath(editor.document.uri)
            );
        }
    });

    context.subscriptions.push(
        startChatCommand, 
        newTaskCommand, 
        stopGenerationCommand,
        toggleAutoApproveCommand,
        sendMessageCommand, 
        acceptActionCommand, 
        previewActionCommand, 
        acceptCommandCommand,
        clearHistoryCommand,
        getHistoryListCommand,
        loadSessionCommand,
        inlineChatCommand
    );
}

export function deactivate() {
    // Cleanup if needed
}
