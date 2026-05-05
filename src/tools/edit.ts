import * as vscode from 'vscode';
import { fileExists, FileOperationResult } from './file';

export async function showDiff(original: string, updated: string, filePath: string) {
    const leftDoc = await vscode.workspace.openTextDocument({
        content: original,
        language: inferLanguage(filePath)
    });

    const rightDoc = await vscode.workspace.openTextDocument({
        content: updated,
        language: inferLanguage(filePath)
    });

    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    await vscode.commands.executeCommand(
        'vscode.diff',
        leftDoc.uri,
        rightDoc.uri,
        `Aether: Changes Preview (${fileName})`
    );
}

export async function applyEdit(filePath: string, newContent: string): Promise<FileOperationResult> {
    if (!(await fileExists(filePath))) {
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

function inferLanguage(filePath: string): string {
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
