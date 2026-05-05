import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/chatView';

export function activate(context: vscode.ExtensionContext) {
    console.log('Aether is now active!');

    // Register Webview Provider for the Sidebar Chat
    const chatViewProvider = new ChatViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('aetherChatView', chatViewProvider)
    );

    // Command: Start Chat
    const startChatCommand = vscode.commands.registerCommand('aether.startChat', () => {
        vscode.commands.executeCommand('aetherChatView.focus');
    });

    const newTaskCommand = vscode.commands.registerCommand('aether.newTask', async () => {
        await chatViewProvider.clearHistory();
        await vscode.commands.executeCommand('aetherChatView.focus');
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
            await vscode.commands.executeCommand('aetherChatView.focus');
            await chatViewProvider.submitInlineRequest(
                query,
                selection || editor.document.getText(),
                vscode.workspace.asRelativePath(editor.document.uri)
            );
        }
    });

    context.subscriptions.push(startChatCommand, newTaskCommand, inlineChatCommand);
}

export function deactivate() { }
