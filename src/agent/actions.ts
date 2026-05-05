import * as vscode from 'vscode';

export type FileAction = { type: 'create' | 'edit'; file: string; content: string };
export type ReadFileAction = { type: 'read_file'; file: string };
export type CommandAction = { type: 'run_command'; command: string; reason?: string };
export type AgentAction = FileAction | ReadFileAction | CommandAction;

export function extractActions(response: string): AgentAction[] {
    const actions: AgentAction[] = [
        ...extractFencedFileActions(response),
        ...extractMarkdownFileActions(response)
    ];

    for (const candidate of extractJsonCandidates(response)) {
        try {
            const parsed = JSON.parse(candidate);
            const parsedActions = Array.isArray(parsed.actions) ? parsed.actions : [parsed];

            for (const action of parsedActions) {
                const normalized = normalizeAction(action);
                if (normalized) {
                    actions.push(normalized);
                }
            }
        } catch {
            // Ignore prose or malformed JSON fragments.
        }
    }

    return actions;
}

export function shouldRequireFileActions(request: string): boolean {
    return /\b(create|build|implement|add|fix|write|update|modify|change|refactor|delete|remove|make)\b/i.test(request);
}

export function createActiveEditorFallbackAction(response: string, request: string): FileAction | undefined {
    if (!shouldRequireFileActions(request)) {
        return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.isUntitled) {
        return undefined;
    }

    const code = extractFirstPlainCodeBlock(response);
    if (!code) {
        return undefined;
    }

    const document = editor.document;
    const relativeFile = vscode.workspace.asRelativePath(document.uri);
    const original = document.getText();
    const selection = editor.selection;
    const content = selection.isEmpty
        ? insertAtPosition(original, document.offsetAt(selection.active), code)
        : replaceRange(original, document.offsetAt(selection.start), document.offsetAt(selection.end), code);

    return {
        type: 'edit',
        file: relativeFile,
        content
    };
}

function normalizeAction(action: unknown): AgentAction | undefined {
    if (!action || typeof action !== 'object') {
        return undefined;
    }

    const candidate = action as Record<string, unknown>;
    if (
        (candidate.type === 'create' || candidate.type === 'edit') &&
        typeof candidate.file === 'string' &&
        typeof candidate.content === 'string'
    ) {
        return {
            type: candidate.type,
            file: candidate.file,
            content: candidate.content
        };
    }

    if (candidate.type === 'read_file' && typeof candidate.file === 'string') {
        return {
            type: 'read_file',
            file: candidate.file
        };
    }

    if (candidate.type === 'run_command' && typeof candidate.command === 'string') {
        return {
            type: 'run_command',
            command: candidate.command,
            reason: typeof candidate.reason === 'string' ? candidate.reason : undefined
        };
    }

    return undefined;
}

function extractFencedFileActions(response: string): AgentAction[] {
    const actions: AgentAction[] = [];
    const blocks = response.matchAll(/```aether-(create|edit)\s+(?:path|file)=([^\n]+)\n([\s\S]*?)```/g);

    for (const block of blocks) {
        const type = block[1] as 'create' | 'edit';
        const file = block[2].trim().replace(/^["']|["']$/g, '');
        const content = block[3].replace(/\s+$/, '');

        if (file && content.length > 0) {
            actions.push({ type, file, content });
        }
    }

    return actions;
}

function extractMarkdownFileActions(response: string): AgentAction[] {
    const actions: AgentAction[] = [];
    const blocks = response.matchAll(/(?:^|\n)(?:#{1,4}\s*)?(?:(File|Create|Edit):)?\s*`?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)`?\s*:?\s*\n```[A-Za-z0-9_-]*\n([\s\S]*?)```/g);

    for (const block of blocks) {
        const mode = block[1]?.toLowerCase();
        const file = block[2].trim().replace(/\\/g, '/');
        const content = block[3].replace(/\s+$/, '');

        if (!looksLikeProjectFile(file) || content.length === 0) {
            continue;
        }

        actions.push({
            type: mode === 'edit' ? 'edit' : 'create',
            file,
            content
        });
    }

    return actions;
}

function extractFirstPlainCodeBlock(response: string): string | undefined {
    const blocks = response.matchAll(/```(?!aether-|json)(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)```/g);
    for (const block of blocks) {
        const content = block[1].replace(/\s+$/, '');
        if (content.length > 0 && !content.trim().startsWith('{')) {
            return content;
        }
    }

    return undefined;
}

function looksLikeProjectFile(file: string): boolean {
    if (file.startsWith('.') || file.includes('..') || file.includes('://')) {
        return false;
    }

    return /^[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/.test(file);
}

function extractJsonCandidates(response: string): string[] {
    const candidates: string[] = [];
    const fencedBlocks = response.matchAll(/```(?:json)?\s*([\s\S]*?)```/g);

    for (const match of fencedBlocks) {
        candidates.push(match[1].trim());
    }

    candidates.push(...extractBalancedJsonObjects(response));

    return candidates;
}

function extractBalancedJsonObjects(text: string): string[] {
    const objects: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0 && start !== -1) {
                objects.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return objects;
}

function replaceRange(original: string, start: number, end: number, replacement: string): string {
    return `${original.slice(0, start)}${replacement}${original.slice(end)}`;
}

function insertAtPosition(original: string, offset: number, insertion: string): string {
    const prefix = original.slice(0, offset);
    const suffix = original.slice(offset);
    const before = prefix.endsWith('\n') || prefix.length === 0 ? '' : '\n';
    const after = suffix.startsWith('\n') || suffix.length === 0 ? '' : '\n';
    return `${prefix}${before}${insertion}${after}${suffix}`;
}
