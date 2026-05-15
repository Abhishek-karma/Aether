import * as vscode from 'vscode';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

export interface ChatHistoryState {
    activeSessionId: string;
    sessions: ChatSession[];
}

const HISTORY_STATE_KEY = 'aether.chatSessions';
const LEGACY_HISTORY_KEY = 'aether.chatHistory';
const MAX_SESSIONS = 30;
const MAX_STORED_MESSAGES = 100;

export class ChatHistoryStore {
    private state: ChatHistoryState;

    constructor(private readonly extensionContext: vscode.ExtensionContext) {
        this.state = this.load();
    }

    get activeSession(): ChatSession {
        const active = this.state.sessions.find(session => session.id === this.state.activeSessionId);
        if (active) {
            return active;
        }

        const fallback = this.state.sessions[0] ?? createSession();
        this.state = {
            activeSessionId: fallback.id,
            sessions: this.state.sessions.length > 0 ? this.state.sessions : [fallback]
        };
        return fallback;
    }

    get sessions(): ChatSession[] {
        return [...this.state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getSession(sessionId: string): ChatSession | undefined {
        return this.state.sessions.find(session => session.id === sessionId);
    }

    async createSession(): Promise<ChatSession> {
        const session = createSession();
        this.state = {
            activeSessionId: session.id,
            sessions: [session, ...this.sessions].slice(0, MAX_SESSIONS)
        };
        await this.save();
        return session;
    }

    async selectSession(sessionId: string): Promise<ChatSession> {
        const session = this.state.sessions.find(item => item.id === sessionId);
        if (!session) {
            return this.activeSession;
        }

        this.state.activeSessionId = session.id;
        await this.save();
        return session;
    }

    async clearActiveSession(): Promise<ChatSession> {
        const active = this.activeSession;
        active.messages = [];
        active.updatedAt = Date.now();
        active.title = 'New chat';
        await this.save();
        return active;
    }

    async appendMessage(message: ChatMessage, sessionId = this.activeSession.id): Promise<ChatSession> {
        const session = this.getSession(sessionId) ?? this.activeSession;
        session.messages = [...session.messages, message].slice(-MAX_STORED_MESSAGES);
        session.updatedAt = Date.now();
        if (message.role === 'user' && session.title === 'New chat') {
            session.title = titleFromMessage(message.content);
        }
        await this.save();
        return session;
    }

    snapshot(): ChatHistoryState {
        return {
            activeSessionId: this.activeSession.id,
            sessions: this.sessions
        };
    }

    private load(): ChatHistoryState {
        const stored = this.extensionContext.workspaceState.get<ChatHistoryState>(HISTORY_STATE_KEY);
        if (stored && Array.isArray(stored.sessions) && stored.sessions.length > 0) {
            const sessions = stored.sessions
                .map(normalizeSession)
                .filter((session): session is ChatSession => Boolean(session));
            if (sessions.length > 0) {
                return {
                    activeSessionId: sessions.some(session => session.id === stored.activeSessionId)
                        ? stored.activeSessionId
                        : sessions[0].id,
                    sessions
                };
            }
        }

        const legacyMessages = this.extensionContext.workspaceState.get<ChatMessage[]>(LEGACY_HISTORY_KEY, []);
        const session = createSession(validateMessages(legacyMessages));
        session.title = session.messages[0]?.role === 'user'
            ? titleFromMessage(session.messages[0].content)
            : 'New chat';
        return {
            activeSessionId: session.id,
            sessions: [session]
        };
    }

    private async save() {
        this.state.sessions = this.sessions.slice(0, MAX_SESSIONS);
        await this.extensionContext.workspaceState.update(HISTORY_STATE_KEY, this.state);
    }
}

function createSession(messages: ChatMessage[] = []): ChatSession {
    const now = Date.now();
    return {
        id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: 'New chat',
        createdAt: now,
        updatedAt: now,
        messages
    };
}

function normalizeSession(session: Partial<ChatSession>): ChatSession | undefined {
    if (typeof session.id !== 'string') {
        return undefined;
    }

    return {
        id: session.id,
        title: typeof session.title === 'string' && session.title.trim() ? session.title : 'New chat',
        createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : Date.now(),
        messages: validateMessages(session.messages)
    };
}

function validateMessages(messages: unknown): ChatMessage[] {
    return Array.isArray(messages)
        ? messages.filter((message): message is ChatMessage =>
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string'
        )
        : [];
}

function titleFromMessage(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return 'New chat';
    }

    return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}
