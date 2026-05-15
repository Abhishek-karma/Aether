import { exec } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot } from './workspace';
import { validateCommand } from '../utils/sanitize';
import { logInfo, logWarn, logError } from '../utils/logger';

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 12000;
const COMMAND_TIMEOUT_MS = 60_000;

export interface CommandResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Executes a shell command in the workspace root.
 * Validates the command against a blocklist of destructive patterns before execution.
 * Supports cancellation via AbortSignal.
 */
export async function runCommand(command: string, signal?: AbortSignal): Promise<CommandResult> {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        throw new Error('No workspace is open.');
    }

    // Validate command safety
    const blocked = validateCommand(command);
    if (blocked) {
        logWarn(`Blocked command: ${command}`);
        throw new Error(blocked);
    }

    logInfo(`Running command: ${command}`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
            signal
        });

        logInfo(`Command succeeded: ${command}`);
        return {
            command,
            exitCode: 0,
            stdout: trimOutput(stdout),
            stderr: trimOutput(stderr)
        };
    } catch (error: any) {
        if (error.name === 'AbortError') {
            logInfo(`Command aborted: ${command}`);
            return {
                command,
                exitCode: -1,
                stdout: '',
                stderr: 'Command was cancelled.'
            };
        }

        const exitCode = typeof error.code === 'number' ? error.code : 1;
        logError(`Command failed (exit ${exitCode}): ${command}`, error);
        return {
            command,
            exitCode,
            stdout: trimOutput(error.stdout || ''),
            stderr: trimOutput(error.stderr || error.message || '')
        };
    }
}

function trimOutput(output: string): string {
    if (output.length <= MAX_OUTPUT_CHARS) {
        return output;
    }

    return `${output.slice(0, MAX_OUTPUT_CHARS)}\n... [output truncated]`;
}
