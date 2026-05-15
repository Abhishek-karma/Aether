import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatView';
import { ChatHistoryStore } from './ui/chatHistory';
import { ContextEngine } from './agent/contextEngine';
import { ModelRouter } from './llm/modelRouter';
import { extractActions } from './agent/actions';
import { applyEdit, showDiff } from './tools/edit';
import { createFile, resolveSafeFilePath, readFile } from './tools/file';
import { runCommand } from './tools/terminal';
import { logInfo, logWarn, logError, getOutputChannel } from './utils/logger';

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
        await chatHistory.clearActiveSession();
        chatViewProvider.postMessage({ type: 'historyLoaded', messages: [] });
        await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    });

    // Command: Stop Generation
    const stopGenerationCommand = vscode.commands.registerCommand('aether.stopGeneration', () => {
        modelRouter.abort();
    });

    // Command: Send Message
    const sendMessageCommand = vscode.commands.registerCommand('aether.sendMessage', async (text: string, modelId?: string) => {
        const history = chatHistory.activeSession.messages;
        
        // Save user message
        await chatHistory.appendMessage({ role: 'user', content: text });

        // Prepare for streaming
        chatViewProvider.postMessage({ type: 'startStream' });

        try {
            const requestMessages = await contextEngine.buildRequestMessages(text, history);
            const selectedModel = await modelRouter.resolve(modelId);
            
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
            chatViewProvider.postMessage({ type: 'endStream' });

            // Detect and show actions
            const actions = extractActions(fullResponse);
            for (const action of actions) {
                if (action.type === 'create' || action.type === 'edit') {
                    const fullPath = resolveSafeFilePath(action.file);
                    let original = '';
                    if (action.type === 'edit') {
                        try { original = await readFile(fullPath); } catch { /* ignore */ }
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
                } else if (action.type === 'run_command') {
                    chatViewProvider.postMessage({
                        type: 'showCommandCard',
                        actionId: Math.random().toString(36).slice(2),
                        command: action.command,
                        reason: action.reason || 'Requested by Aether'
                    });
                }
            }
        } catch (error: any) {
            logError('Chat generation failed', error);
            chatViewProvider.postMessage({ type: 'error', message: error.message || 'An unknown error occurred' });
        }
    });

    // Command: Accept File Action
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

    // Command: Accept Command
    const acceptCommandCommand = vscode.commands.registerCommand('aether.acceptCommand', async (data: any) => {
        try {
            const result = await runCommand(data.command);
            chatViewProvider.postMessage({
                type: 'updateToolCard',
                actionId: data.actionId,
                status: result.exitCode === 0 ? 'done' : 'error',
                output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
            });
            
            // Removed auto-feedback loop that caused infinite LLM chatting
            // The user can manually tell the LLM if they want to.
            if (result.exitCode !== 0) {
                logWarn(`Command failed, wait for user input. Exit code: ${result.exitCode}`);
            }
        } catch (error: any) {
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
            label: new Date(s.updatedAt).toLocaleString(),
            description: s.messages.length > 0 ? s.messages[0].content.substring(0, 50) + '...' : 'Empty Session',
            session: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a previous chat session'
        });

        if (selected) {
            await chatHistory.selectSession(selected.session.id);
            chatViewProvider.postMessage({ type: 'historyLoaded', messages: selected.session.messages });
            await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
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
        sendMessageCommand, 
        acceptActionCommand, 
        previewActionCommand, 
        acceptCommandCommand,
        clearHistoryCommand,
        showHistoryCommand,
        inlineChatCommand
    );
}

export function deactivate() {
    // Cleanup if needed
}
