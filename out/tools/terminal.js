"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
const child_process_1 = require("child_process");
const util_1 = require("util");
const workspace_1 = require("./workspace");
const sanitize_1 = require("../utils/sanitize");
const logger_1 = require("../utils/logger");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const MAX_OUTPUT_CHARS = 12000;
const COMMAND_TIMEOUT_MS = 60_000;
/**
 * Executes a shell command in the workspace root.
 * Validates the command against a blocklist of destructive patterns before execution.
 * Supports cancellation via AbortSignal.
 */
async function runCommand(command, signal) {
    const cwd = (0, workspace_1.getWorkspaceRoot)();
    if (!cwd) {
        throw new Error('No workspace is open.');
    }
    // Validate command safety
    const blocked = (0, sanitize_1.validateCommand)(command);
    if (blocked) {
        (0, logger_1.logWarn)(`Blocked command: ${command}`);
        throw new Error(blocked);
    }
    (0, logger_1.logInfo)(`Running command: ${command}`);
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
            signal
        });
        (0, logger_1.logInfo)(`Command succeeded: ${command}`);
        return {
            command,
            exitCode: 0,
            stdout: trimOutput(stdout),
            stderr: trimOutput(stderr)
        };
    }
    catch (error) {
        if (error.name === 'AbortError') {
            (0, logger_1.logInfo)(`Command aborted: ${command}`);
            return {
                command,
                exitCode: -1,
                stdout: '',
                stderr: 'Command was cancelled.'
            };
        }
        const exitCode = typeof error.code === 'number' ? error.code : 1;
        (0, logger_1.logError)(`Command failed (exit ${exitCode}): ${command}`, error);
        return {
            command,
            exitCode,
            stdout: trimOutput(error.stdout || ''),
            stderr: trimOutput(error.stderr || error.message || '')
        };
    }
}
function trimOutput(output) {
    if (output.length <= MAX_OUTPUT_CHARS) {
        return output;
    }
    return `${output.slice(0, MAX_OUTPUT_CHARS)}\n... [output truncated]`;
}
//# sourceMappingURL=terminal.js.map