# Changelog

## [0.2.0]
- **Security**: Added Content Security Policy (CSP), nonce generation, and HTML sanitization.
- **Security**: Added blocklist for dangerous terminal commands.
- **UX**: Added "Stop Generation" support via `AbortController` throughout the pipeline.
- **UX**: Added copy-to-clipboard buttons for markdown code blocks.
- **UX**: Restyled `<think>` reasoning tokens into collapsible details blocks for readability.
- **UX**: Added empty state placeholders.
- **Fix**: Context engine now correctly includes the user's current message in the prompt window.
- **Fix**: Removed infinite LLM loop caused by auto-feedback from terminal commands.
- **Fix**: Share a single `ModelRouter` instance to prevent stale cache bugs.
- **Fix**: Added proper output channel logging instead of hidden `console.error`.
- **Refactor**: Expanded file extension mapping for syntax highlighting from 8 to 60+ languages.
