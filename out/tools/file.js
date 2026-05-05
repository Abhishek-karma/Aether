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
exports.createFile = createFile;
exports.readFile = readFile;
exports.fileExists = fileExists;
exports.resolveSafeFilePath = resolveSafeFilePath;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const workspace_1 = require("./workspace");
async function createFile(filePath, content) {
    const uri = vscode.Uri.file(filePath);
    try {
        await vscode.workspace.fs.stat(uri);
        const message = `File already exists: ${filePath}`;
        vscode.window.showErrorMessage(message);
        return { ok: false, message };
    }
    catch {
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
async function readFile(filePath) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    return new TextDecoder().decode(bytes);
}
async function fileExists(filePath) {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    }
    catch {
        return false;
    }
}
function resolveSafeFilePath(file) {
    return (0, workspace_1.resolveWorkspacePath)(file.replace(/^[/\\]+/, ''));
}
//# sourceMappingURL=file.js.map