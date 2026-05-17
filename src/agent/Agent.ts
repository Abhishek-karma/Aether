import * as vscode from 'vscode';
import { ModelRouter, SelectedModel, LlmMessage } from '../llm/modelRouter';
import { extractActions, AgentAction, shouldRequireFileActions } from './actions';
import { ChatHistoryStore } from '../ui/chatHistory';
import { logInfo, logWarn, logError } from '../utils/logger';
import { ChatViewProvider } from '../ui/chatView';
import { applyEdit } from '../tools/edit';
import { createFile, resolveSafeFilePath, readFile } from '../tools/file';
import { runCommand } from '../tools/terminal';
import { ContextEngine } from './contextEngine';
import { generateSystemPrompt } from './prompt';

const MAX_CONTINUATION_RETRIES = 2;
const NUDGE_MESSAGE = 'You explained what to do but did not write any `aether-create` or `aether-edit` action blocks. Please output the code modifications now.';

export class Agent {
    constructor(
        private modelRouter: ModelRouter,
        private chatHistory: ChatHistoryStore,
        private chatViewProvider: ChatViewProvider,
        private contextEngine: ContextEngine
    ) {}

    async run(userText: string, modelId: string, autoApproveEnabled: boolean) {
        try {
            const selectedModel = await this.modelRouter.resolve(modelId);
            await this.chatHistory.appendMessage({ role: 'user', content: userText });
            this.chatViewProvider.postMessage({ type: 'startStream' });

            let retryCount = 0;
            let allActions: AgentAction[] = [];

            while (true) {
                const session = this.chatHistory.activeSession;
                
                const currentHistory = session.messages;
                const requestMessages = await this.contextEngine.buildRequestMessages(
                    retryCount === 0 ? userText : NUDGE_MESSAGE,
                    currentHistory.slice(0, -1) // exclude the nudge itself from duplication
                );

                let fullResponse = '';
                try {
                    const stream = this.modelRouter.chatStream(requestMessages, selectedModel);
                    for await (const chunk of stream) {
                        fullResponse += chunk;
                        this.chatViewProvider.postMessage({ type: 'streamChunk', chunk });
                    }
                } catch (streamError: any) {
                    if (streamError.name === 'AbortError') {
                        this.chatViewProvider.postMessage({ type: 'endStream' });
                        return;
                    }
                    throw streamError;
                }

                await this.chatHistory.appendMessage({ role: 'assistant', content: fullResponse });

                const actions = extractActions(fullResponse);
                allActions.push(...actions);

                if (actions.length > 0 || !shouldRequireFileActions(userText)) {
                    break; // Success or no actions needed
                }

                retryCount++;
                if (retryCount > MAX_CONTINUATION_RETRIES) {
                    break;
                }

                logWarn(`No actions found in response, auto-continuing (attempt ${retryCount}/${MAX_CONTINUATION_RETRIES})`);
                this.chatViewProvider.postMessage({ type: 'streamChunk', chunk: '\n\n---\n*Generating code...*\n\n' });
                await this.chatHistory.appendMessage({ role: 'user', content: NUDGE_MESSAGE });
            }

            this.chatViewProvider.postMessage({ type: 'endStream' });

            // Execute Actions
            await this.executeActions(allActions, autoApproveEnabled);

        } catch (error: any) {
            logError('Agent generation failed', error);
            this.chatViewProvider.postMessage({ type: 'error', message: error.message || 'An unknown error occurred' });
        }
    }

    private async executeActions(actions: AgentAction[], autoApproveEnabled: boolean) {
        for (const action of actions) {
            if (action.type === 'create' || action.type === 'edit') {
                const fullPath = resolveSafeFilePath(action.file);

                if (autoApproveEnabled) {
                    const actionId = Math.random().toString(36).slice(2);
                    this.chatViewProvider.postMessage({
                        type: 'showActionCard',
                        actionId,
                        actionType: action.type,
                        file: action.file,
                        content: action.content,
                        original: '',
                        fullPath,
                        autoApplied: true
                    });

                    let result = action.type === 'create' 
                        ? await createFile(fullPath, action.content, true) 
                        : await applyEdit(fullPath, action.content);

                    this.chatViewProvider.postMessage({
                        type: 'fileActionResult',
                        actionId,
                        ok: result.ok,
                        message: result.message
                    });

                    logInfo(`Auto-applied ${action.type}: ${action.file} — ${result.ok ? 'OK' : 'FAILED'}`);
                } else {
                    this.chatViewProvider.postMessage({
                        type: 'showActionCard',
                        actionId: Math.random().toString(36).slice(2),
                        actionType: action.type,
                        file: action.file,
                        content: action.content,
                        original: '', // Fetch original if needed
                        fullPath
                    });
                }
            } else if (action.type === 'run_command') {
                if (autoApproveEnabled) {
                    const actionId = Math.random().toString(36).slice(2);
                    this.chatViewProvider.postMessage({
                        type: 'showCommandCard',
                        actionId,
                        command: action.command,
                        reason: action.reason || 'Auto-executed by Aether',
                        autoApplied: true
                    });

                    try {
                        const result = await runCommand(action.command);
                        this.chatViewProvider.postMessage({
                            type: 'updateToolCard',
                            actionId,
                            status: result.exitCode === 0 ? 'done' : 'error',
                            output: result.stdout + (result.stderr ? '\n' + result.stderr : '')
                        });
                    } catch (error: any) {
                        this.chatViewProvider.postMessage({
                            type: 'updateToolCard',
                            actionId,
                            status: 'error',
                            output: error.message
                        });
                    }
                } else {
                    this.chatViewProvider.postMessage({
                        type: 'showCommandCard',
                        actionId: Math.random().toString(36).slice(2),
                        command: action.command,
                        reason: action.reason || 'Requested by Aether'
                    });
                }
            }
        }
    }
}
