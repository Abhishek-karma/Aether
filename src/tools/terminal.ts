import { exec } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot } from './workspace';

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 12000;

export interface CommandResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
}

export async function runCommand(command: string): Promise<CommandResult> {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        throw new Error('No workspace is open.');
    }

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            windowsHide: true
        });

        return {
            command,
            exitCode: 0,
            stdout: trimOutput(stdout),
            stderr: trimOutput(stderr)
        };
    } catch (error: any) {
        return {
            command,
            exitCode: typeof error.code === 'number' ? error.code : 1,
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
