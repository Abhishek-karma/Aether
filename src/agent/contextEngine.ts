import { generateSystemPrompt } from './prompt';
import { ChatMessage } from '../ui/chatHistory';
import { collectWorkspaceContext } from '../tools/workspace';

const MAX_RECENT_MESSAGES = 20;

export class ContextEngine {
    /**
     * Builds the full message array sent to the LLM:
     *   [system] + [recent history] + [current user message]
     * 
     * Previous implementation silently dropped the current user message —
     * it was only saved to history but never actually sent to the model.
     */
    async buildRequestMessages(userRequest: string, history: ChatMessage[]) {
        const workspaceContext = await collectWorkspaceContext(userRequest);
        return [
            {
                role: 'system' as const,
                content: generateSystemPrompt(
                    workspaceContext.snippets,
                    workspaceContext.workspaceRoot || 'No workspace opened'
                )
            },
            ...history.slice(-MAX_RECENT_MESSAGES),
            {
                role: 'user' as const,
                content: userRequest
            }
        ];
    }
}
