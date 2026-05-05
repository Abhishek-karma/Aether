import * as vscode from 'vscode';
import * as path from 'path';
import { resolveWorkspacePath } from './workspace';

export interface FileOperationResult {
    ok: boolean;
    message: string;
}

export async function createFile(filePath: string, content: string): Promise<FileOperationResult> {
    const uri = vscode.Uri.file(filePath);

    try {
        await vscode.workspace.fs.stat(uri);
        const message = `File already exists: ${filePath}`;
        vscode.window.showErrorMessage(message);
        return { ok: false, message };
    } catch {
        // File does not exist, safe to create
    }

    const directory = vscode.Uri.file(path.dirname(filePath));
    await vscode.workspace.fs.createDirectory(directory);

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });

    const message = `File created: ${filePath}`;
    vscode.window.showInformationMessage(message);
    return { ok: true, message };
}

export async function readFile(filePath: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return new TextDecoder().decode(bytes);
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    } catch {
        return false;
    }
}

export function resolveSafeFilePath(file: string): string {
    return resolveWorkspacePath(file.replace(/^[/\\]+/, ''));
}
