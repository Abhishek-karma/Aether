import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatView';
import { ChatHistoryStore } from './ui/chatHistory';
import { ContextEngine } from './agent/contextEngine';
import { ModelRouter } from './llm/modelRouter';
import { extractActions, shouldRequireFileActions } from './agent/actions';
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
        await chatHistory.clearActiveSession();
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
            let allActions: ReturnType<typeof extractActions> = [];

            // Agentic loop: stream -> extract actions -> retry if no actions found
            while (retryCount <= MAX_CONTINUATION_RETRIES) {
                const currentHistory = chatHistory.activeSession.messages;
                const requestMessages = await contextEngine.buildRequestMessages(
                    retryCount === 0 ? text : NUDGE_MESSAGE,
                    currentHistory.slice(0, -1) // exclude the nudge itself from duplication
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
                const actions = extractActions(fullResponse);
                allActions.push(...actions);

                if (actions.length > 0) {
                    // We got actions — break out of the retry loop
                    break;
                }

                // No actions found — check if the request even needed actions
                if (!shouldRequireFileActions(text)) {
                    // Pure question/explanation — no retry needed
                    break;
                }

                // Actions were expected but not found — auto-continue
                retryCount++;
                if (retryCount <= MAX_CONTINUATION_RETRIES) {
                    logWarn(`No actions found in response, auto-continuing (attempt ${retryCount}/${MAX_CONTINUATION_RETRIES})`);
                    
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
                    const fullPath = resolveSafeFilePath(action.file);

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
                            result = await createFile(fullPath, action.content, true);
                        } else {
                            result = await applyEdit(fullPath, action.content);
                        }

                        chatViewProvider.postMessage({
                            type: 'fileActionResult',
                            actionId,
                            ok: result.ok,
                            message: result.message
                        });

                        logInfo(`Auto-applied ${action.type}: ${action.file} — ${result.ok ? 'OK' : 'FAILED'}`);
                    } else {
                        // Manual mode: show interactive action card
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
                    }
                } else if (action.type === 'run_command') {
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
                            const result = await runCommand(action.command);
                            chatViewProvider.postMessage({
                                type: 'updateToolCard',
                                actionId,
                                status: result.exitCode === 0 ? 'done' : 'error',
                                output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
                            });
                        } catch (error: any) {
                            chatViewProvider.postMessage({
                                type: 'updateToolCard',
                                actionId,
                                status: 'error',
                                output: error.message
                            });
                        }
                    } else {
                        chatViewProvider.postMessage({
                            type: 'showCommandCard',
                            actionId: Math.random().toString(36).slice(2),
                            command: action.command,
                            reason: action.reason || 'Requested by Aether'
                        });
                    }
                }
            }
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
        toggleAutoApproveCommand,
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
