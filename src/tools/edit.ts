import * as vscode from 'vscode';

export async function showDiff(original: string, updated: string, filePath: string) {
    const left = vscode.Uri.parse(`untitled:${filePath}-old`);
    const right = vscode.Uri.parse(`untitled:${filePath}-new`);

    await vscode.workspace.openTextDocument(left).then(doc => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(left, new vscode.Position(0, 0), original);
        return vscode.workspace.applyEdit(edit);
    });

    await vscode.workspace.openTextDocument(right).then(doc => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(right, new vscode.Position(0, 0), updated);
        return vscode.workspace.applyEdit(edit);
    });

    await vscode.commands.executeCommand(
        'vscode.diff',
        left,
        right,
        'Aether Preview Changes'
    );
}

export async function applyEdit(filePath: string, newContent: string) {
    const uri = vscode.Uri.file(filePath);

    const edit = new vscode.WorkspaceEdit();
    // Replace the entire file with new content
    edit.replace(
        uri,
        new vscode.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE),
        newContent
    );

    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage("Changes applied");
}
