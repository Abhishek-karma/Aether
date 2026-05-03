import * as vscode from 'vscode';
import * as path from 'path';
import { OllamaClient } from '../llm/ollama';
import { generateSystemPrompt } from '../agent/prompt';
import { createFile, readFile } from '../tools/file';
import { showDiff, applyEdit } from '../tools/edit';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private ollamaClient: OllamaClient;
    private messages: { role: 'system' | 'user' | 'assistant', content: string }[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.ollamaClient = new OllamaClient();
        
        // Initialize system prompt
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'No workspace opened';
        this.messages.push({
            role: 'system',
            content: generateSystemPrompt([], workspacePath)
        });
    }

    public async resolveWebviewView(
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

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.text, data.model);
                    break;
                case 'getModels':
                    const models = await this.ollamaClient.listModels();
                    this._view?.webview.postMessage({ type: 'modelsLoaded', models });
                    break;
            }
        });
    }

    private async handleUserMessage(text: string, model: string) {
        if (!this._view) return;

        // Add user message
        this.messages.push({ role: 'user', content: text });
        
        // Notify UI that assistant is typing
        this._view.webview.postMessage({ type: 'startStream' });

        try {
            let fullResponse = '';
            
            // Stream response
            const stream = this.ollamaClient.chatStream(this.messages, { model });
            
            for await (const chunk of stream) {
                fullResponse += chunk;
                this._view.webview.postMessage({ 
                    type: 'streamChunk', 
                    chunk 
                });
            }

            // Save assistant response
            this.messages.push({ role: 'assistant', content: fullResponse });
            
            this._view.webview.postMessage({ type: 'endStream' });

            // Post-process the response for JSON tool calls
            await this.processAgentActions(fullResponse);

        } catch (error: any) {
            this._view.webview.postMessage({ 
                type: 'error', 
                message: error.message || 'An error occurred connecting to Ollama' 
            });
        }
    }

    private async processAgentActions(response: string) {
        try {
            // Find JSON blocks in the text
            const jsonRegex = /\{[\s\S]*?\}/g;
            const matches = response.match(jsonRegex);
            
            if (!matches) return;

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) return;

            for (const match of matches) {
                try {
                    const parsed = JSON.parse(match);
                    
                    if (parsed.type === 'create' && parsed.file && parsed.content) {
                        const fullPath = path.join(workspaceRoot, parsed.file);
                        await createFile(fullPath, parsed.content);
                    }
                    
                    if (parsed.type === 'edit' && parsed.file && parsed.content) {
                        const fullPath = path.join(workspaceRoot, parsed.file);
                        const original = await readFile(fullPath);
                        
                        await showDiff(original, parsed.content, fullPath);

                        const confirm = await vscode.window.showInformationMessage(
                            `Apply changes to ${parsed.file}?`,
                            "Accept",
                            "Reject"
                        );

                        if (confirm === "Accept") {
                            await applyEdit(fullPath, parsed.content);
                        }
                    }
                } catch (e) {
                    // Not valid JSON or failed to process, ignore this block
                }
            }
        } catch (error) {
            console.error('Error processing agent actions:', error);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Basic MVP HTML UI using the Webview UI Toolkit
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aether Chat</title>
    <script type="module" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit@1.2.2/dist/toolkit.min.js"></script>
    <style>
        body { padding: 10px; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); }
        .chat-container { display: flex; flex-direction: column; height: 100vh; }
        .messages { flex-grow: 1; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
        .message { padding: 8px; border-radius: 4px; line-height: 1.4; }
        .user-message { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; max-width: 80%; }
        .assistant-message { background-color: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; max-width: 90%; }
        .input-container { display: flex; flex-direction: column; gap: 8px; padding-bottom: 20px; }
        .model-selector { margin-bottom: 10px; }
        .error { color: var(--vscode-errorForeground); margin-top: 5px; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="model-selector">
            <vscode-dropdown id="modelSelect">
                <vscode-option>Loading models...</vscode-option>
            </vscode-dropdown>
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
        const modelSelect = document.getElementById('modelSelect');
        
        let currentAssistantMessage = null;

        // Request models on load
        vscode.postMessage({ type: 'getModels' });

        sendBtn.addEventListener('click', () => {
            const text = userInput.value.trim();
            const model = modelSelect.value;
            if (text) {
                // Add user message to UI
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message user-message';
                msgDiv.textContent = text;
                messagesContainer.appendChild(msgDiv);
                
                // Clear input
                userInput.value = '';
                
                // Send to extension
                vscode.postMessage({ type: 'sendMessage', text, model });
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'modelsLoaded':
                    modelSelect.innerHTML = '';
                    if (message.models.length === 0) {
                        const opt = document.createElement('vscode-option');
                        opt.textContent = 'No models found';
                        modelSelect.appendChild(opt);
                    } else {
                        message.models.forEach(model => {
                            const opt = document.createElement('vscode-option');
                            opt.value = model;
                            opt.textContent = model;
                            modelSelect.appendChild(opt);
                        });
                    }
                    break;
                case 'startStream':
                    currentAssistantMessage = document.createElement('div');
                    currentAssistantMessage.className = 'message assistant-message';
                    messagesContainer.appendChild(currentAssistantMessage);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    break;
                case 'streamChunk':
                    if (currentAssistantMessage) {
                        currentAssistantMessage.textContent += message.chunk;
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                    break;
                case 'endStream':
                    currentAssistantMessage = null;
                    break;
                case 'error':
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error';
                    errorDiv.textContent = message.message;
                    messagesContainer.appendChild(errorDiv);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
