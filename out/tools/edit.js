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
const logger_1 = require("../utils/logger");
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
    (0, logger_1.logInfo)(message);
    vscode.window.showInformationMessage(message);
    return { ok: true, message };
}
const LANGUAGE_MAP = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'jsonc',
    md: 'markdown',
    mdx: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    ps1: 'powershell',
    psm1: 'powershell',
    bat: 'bat',
    cmd: 'bat',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    cfg: 'ini',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    dockerfile: 'dockerfile',
    vue: 'vue',
    svelte: 'svelte',
    dart: 'dart',
    r: 'r',
    lua: 'lua',
    php: 'php',
    pl: 'perl',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hs: 'haskell',
    scala: 'scala',
    clj: 'clojure',
    tf: 'terraform',
    proto: 'protobuf',
    makefile: 'makefile',
    cmake: 'cmake',
};
function inferLanguage(filePath) {
    const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase() || '';
    // Handle files without extensions (Dockerfile, Makefile, etc.)
    if (LANGUAGE_MAP[fileName]) {
        return LANGUAGE_MAP[fileName];
    }
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension ? (LANGUAGE_MAP[extension] ?? 'plaintext') : 'plaintext';
}
//# sourceMappingURL=edit.js.map