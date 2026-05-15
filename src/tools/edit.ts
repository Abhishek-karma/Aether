import * as vscode from 'vscode';
import { fileExists, FileOperationResult } from './file';
import { logInfo } from '../utils/logger';

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
    logInfo(message);
    vscode.window.showInformationMessage(message);
    return { ok: true, message };
}

const LANGUAGE_MAP: Record<string, string> = {
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

function inferLanguage(filePath: string): string {
    const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase() || '';
    
    // Handle files without extensions (Dockerfile, Makefile, etc.)
    if (LANGUAGE_MAP[fileName]) {
        return LANGUAGE_MAP[fileName];
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension ? (LANGUAGE_MAP[extension] ?? 'plaintext') : 'plaintext';
}
