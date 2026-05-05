"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
const child_process_1 = require("child_process");
const util_1 = require("util");
const workspace_1 = require("./workspace");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const MAX_OUTPUT_CHARS = 12000;
async function runCommand(command) {
    const cwd = (0, workspace_1.getWorkspaceRoot)();
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
    }
    catch (error) {
        return {
            command,
            exitCode: typeof error.code === 'number' ? error.code : 1,
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