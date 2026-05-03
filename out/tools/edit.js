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
async function showDiff(original, updated, filePath) {
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
    await vscode.commands.executeCommand('vscode.diff', left, right, 'Aether Preview Changes');
}
async function applyEdit(filePath, newContent) {
    const uri = vscode.Uri.file(filePath);
    const edit = new vscode.WorkspaceEdit();
    // Replace the entire file with new content
    edit.replace(uri, new vscode.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE), newContent);
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage("Changes applied");
}
//# sourceMappingURL=edit.js.map