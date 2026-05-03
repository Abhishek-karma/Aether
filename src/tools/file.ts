import * as vscode from 'vscode';

export async function createFile(filePath: string, content: string) {
    const uri = vscode.Uri.file(filePath);

    // Check if file already exists
    try {
        await vscode.workspace.fs.stat(uri);
        vscode.window.showErrorMessage(`File already exists: ${filePath}`);
        return;
    } catch {
        // File does not exist, safe to create
    }

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

    vscode.window.showInformationMessage(`File created: ${filePath}`);
}

export async function readFile(filePath: string): Promise<string> {
    try {
        const uri = vscode.Uri.file(filePath);
        const uint8Array = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(uint8Array);
    } catch {
        return '';
    }
}
