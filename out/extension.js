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
function activate(context) {
    console.log('Aether is now active!');
    // Register Webview Provider for the Sidebar Chat
    const chatViewProvider = new chatView_1.ChatViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('aetherChatView', chatViewProvider));
    // Command: Start Chat
    const startChatCommand = vscode.commands.registerCommand('aether.startChat', () => {
        vscode.commands.executeCommand('aetherChatView.focus');
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
            // Forward to chat view or handle inline diff UI
            vscode.window.showInformationMessage(`Aether inline chat triggered with: ${query}`);
            // TODO: Implement inline edit flow with diff preview
        }
    });
    context.subscriptions.push(startChatCommand, inlineChatCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map