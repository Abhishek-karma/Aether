/**
 * Minimal HTML sanitization for webview-rendered content.
 * Strips dangerous tags/attributes while preserving safe markdown output.
 */
const DANGEROUS_TAGS = /(<\s*\/?\s*(script|iframe|object|embed|form|link|meta|base|applet)(\s[^>]*)?>)/gi;
const EVENT_HANDLERS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URLS = /(href|src|action)\s*=\s*["']?\s*javascript:/gi;

/**
 * Sanitizes HTML output from markdown rendering.
 * Removes script tags, event handlers, and javascript: URLs.
 */
export function sanitizeHtml(html: string): string {
    return html
        .replace(DANGEROUS_TAGS, '')
        .replace(EVENT_HANDLERS, '')
        .replace(JAVASCRIPT_URLS, '$1="about:blank"');
}

/**
 * Commands that are too dangerous to run via the agent.
 * Patterns are tested case-insensitively against the full command string.
 */
const BLOCKED_COMMAND_PATTERNS = [
    /\brm\s+(-rf?|--recursive)\s+[/\\]/i,         // rm -rf /
    /\bformat\s+[a-z]:/i,                          // format C:
    /\b(shutdown|reboot|halt|poweroff)\b/i,         // system shutdown
    /\b(mkfs|dd\s+if=)\b/i,                        // disk wipe
    /\b(curl|wget|Invoke-WebRequest).*\|\s*(sh|bash|powershell|cmd)/i, // pipe to shell
    /\bREG\s+(DELETE|ADD).*\\\\HKLM/i,              // registry mutation
    /\b(del|rmdir)\s+\/s\s+\/q\s+[a-z]:\\\\/i,     // Windows recursive delete root
];

/**
 * Validates a command against a blocklist of destructive patterns.
 * Returns an error message if blocked, or undefined if safe to run.
 */
export function validateCommand(command: string): string | undefined {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
            return `Command blocked for safety: "${command}" matches a destructive pattern.`;
        }
    }
    return undefined;
}
