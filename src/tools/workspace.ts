import * as path from 'path';
import * as vscode from 'vscode';

const TEXT_EXTENSIONS = new Set([
    '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.html', '.java', '.js', '.json',
    '.jsx', '.md', '.py', '.rs', '.scss', '.ts', '.tsx', '.txt', '.vue', '.yaml',
    '.yml'
]);

const MAX_FILE_CHARS = 6000;
const MAX_CONTEXT_CHARS = 18000;

export interface WorkspaceContext {
    workspaceRoot?: string;
    activeFile?: string;
    snippets: string[];
}

export function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getRelativePath(filePath: string): string {
    const root = getWorkspaceRoot();
    return root ? path.relative(root, filePath).replace(/\\/g, '/') : filePath;
}

export function resolveWorkspacePath(relativePath: string): string {
    const root = getWorkspaceRoot();
    if (!root) {
        throw new Error('No workspace is open.');
    }

    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Path is outside the workspace: ${relativePath}`);
    }

    return resolved;
}

export async function collectWorkspaceContext(userRequest: string): Promise<WorkspaceContext> {
    const workspaceRoot = getWorkspaceRoot();
    const snippets: string[] = [];
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
        const document = activeEditor.document;
        const selectedText = document.getText(activeEditor.selection);
        const content = selectedText || document.getText();
        snippets.push(formatSnippet(
            selectedText ? 'Selected code' : 'Active file',
            getRelativePath(document.uri.fsPath),
            content
        ));
    }

    const roots = await vscode.workspace.findFiles(
        '{package.json,README.md,readme.md,tsconfig.json,src/**/*}',
        '{node_modules,out,dist,.git,.vscode-test}/**',
        80
    );

    const terms = new Set(
        userRequest
            .toLowerCase()
            .split(/[^a-z0-9_.-]+/)
            .filter(term => term.length > 2)
    );

    const scored = roots
        .filter(uri => shouldReadFile(uri.fsPath))
        .map(uri => {
            const relative = getRelativePath(uri.fsPath).toLowerCase();
            let score = relative.startsWith('src/') ? 2 : 1;
            for (const term of terms) {
                if (relative.includes(term)) {
                    score += 3;
                }
            }
            return { uri, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

    let total = snippets.join('\n\n').length;
    for (const item of scored) {
        if (activeEditor && item.uri.fsPath === activeEditor.document.uri.fsPath) {
            continue;
        }

        const bytes = await vscode.workspace.fs.readFile(item.uri);
        const content = new TextDecoder().decode(bytes);
        const snippet = formatSnippet('Workspace file', getRelativePath(item.uri.fsPath), content);
        if (total + snippet.length > MAX_CONTEXT_CHARS) {
            break;
        }
        snippets.push(snippet);
        total += snippet.length;
    }

    return {
        workspaceRoot,
        activeFile: activeEditor ? getRelativePath(activeEditor.document.uri.fsPath) : undefined,
        snippets
    };
}

function shouldReadFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
}

function formatSnippet(label: string, file: string, content: string): string {
    const clipped = content.length > MAX_FILE_CHARS
        ? `${content.slice(0, MAX_FILE_CHARS)}\n... [truncated]`
        : content;

    return `${label}: ${file}\n\`\`\`\n${clipped}\n\`\`\``;
}
