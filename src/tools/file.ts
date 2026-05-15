import * as vscode from 'vscode';
import * as path from 'path';
import { resolveWorkspacePath } from './workspace';
import { logInfo, logError } from '../utils/logger';

export interface FileOperationResult {
    ok: boolean;
    message: string;
}

/**
 * Creates a new file at the given path.
 * If autoApprove is true, overwrites without prompting.
 * Otherwise prompts the user to confirm overwrite.
 */
export async function createFile(filePath: string, content: string, autoApprove: boolean = false): Promise<FileOperationResult> {
    const uri = vscode.Uri.file(filePath);

    try {
        await vscode.workspace.fs.stat(uri);
        
        if (!autoApprove) {
            // File exists — ask user whether to overwrite
            const choice = await vscode.window.showWarningMessage(
                `File already exists: ${path.basename(filePath)}. Overwrite?`,
                { modal: false },
                'Overwrite',
                'Cancel'
            );

            if (choice !== 'Overwrite') {
                const message = `Skipped existing file: ${filePath}`;
                logInfo(message);
                return { ok: false, message };
            }
        } else {
            logInfo(`Auto-approve: overwriting ${filePath}`);
        }
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
    logInfo(message);
    if (!autoApprove) {
        vscode.window.showInformationMessage(message);
    }
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
