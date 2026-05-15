import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

/**
 * Returns the shared Aether output channel visible in the VS Code Output panel.
 * Lazily created on first call.
 */
export function getOutputChannel(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('Aether');
    }
    return _channel;
}

/** Log an informational message to the Aether output channel. */
export function logInfo(message: string): void {
    getOutputChannel().appendLine(`[INFO  ${timestamp()}] ${message}`);
}

/** Log a warning message to the Aether output channel. */
export function logWarn(message: string): void {
    getOutputChannel().appendLine(`[WARN  ${timestamp()}] ${message}`);
}

/** Log an error message to the Aether output channel. */
export function logError(message: string, error?: unknown): void {
    const suffix = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    getOutputChannel().appendLine(`[ERROR ${timestamp()}] ${message}${suffix}`);
}

function timestamp(): string {
    return new Date().toISOString().slice(11, 23);
}
