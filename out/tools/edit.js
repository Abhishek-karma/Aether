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
exports.showDiff = showDiff;
exports.applyEdit = applyEdit;
const vscode = __importStar(require("vscode"));
const file_1 = require("./file");
async function showDiff(original, updated, filePath) {
    const leftDoc = await vscode.workspace.openTextDocument({
        content: original,
        language: inferLanguage(filePath)
    });
    const rightDoc = await vscode.workspace.openTextDocument({
        content: updated,
        language: inferLanguage(filePath)
    });
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    await vscode.commands.executeCommand('vscode.diff', leftDoc.uri, rightDoc.uri, `Aether: Changes Preview (${fileName})`);
}
async function applyEdit(filePath, newContent) {
    if (!(await (0, file_1.fileExists)(filePath))) {
        const message = `Cannot edit missing file: ${filePath}`;
        vscode.window.showErrorMessage(message);
        return { ok: false, message };
    }
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(newContent));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    const message = `Changes applied: ${filePath}`;
    vscode.window.showInformationMessage(message);
    return { ok: true, message };
}
function inferLanguage(filePath) {
    const extension = filePath.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'ts':
            return 'typescript';
        case 'tsx':
            return 'typescriptreact';
        case 'js':
            return 'javascript';
        case 'jsx':
            return 'javascriptreact';
        case 'json':
            return 'json';
        case 'md':
            return 'markdown';
        case 'css':
            return 'css';
        case 'html':
            return 'html';
        default:
            return 'plaintext';
    }
}
//# sourceMappingURL=edit.js.map