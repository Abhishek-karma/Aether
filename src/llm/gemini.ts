import * as vscode from 'vscode';
import { GoogleGenAI } from '@google/genai';
import { logInfo, logError } from '../utils/logger';

export interface GeminiMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface GeminiOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/** Available Gemini models via Google AI Studio. */
export const AVAILABLE_MODELS: { id: string; label: string }[] = [
    { id: 'gemini-2.5-flash',            label: 'Gemini 2.5 Flash (thinking)' },
    { id: 'gemini-2.5-pro',              label: 'Gemini 2.5 Pro (thinking)' },
    { id: 'gemini-2.0-flash',            label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite',       label: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-1.5-pro',              label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash',            label: 'Gemini 1.5 Flash' },
];

const AVAILABLE_MODELS_BY_ID = new Map(AVAILABLE_MODELS.map(m => [m.id, m]));

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('aether').get<T>(key, fallback);
}

export class GeminiClient {
    private client?: GoogleGenAI;
    private clientApiKey?: string;

    /**
     * Lazily creates or reuses the GoogleGenAI client.
     * Rebuilds when the configured API key changes.
     */
    private getClient(): GoogleGenAI {
        const apiKey = cfg<string>('geminiApiKey', '').trim();
        if (!apiKey) {
            throw new Error(
                'Gemini API key is not set. Open Settings > Aether > Gemini Api Key and paste your key from aistudio.google.com.'
            );
        }

        if (!this.client || this.clientApiKey !== apiKey) {
            this.client = new GoogleGenAI({ apiKey });
            this.clientApiKey = apiKey;
        }

        return this.client;
    }

    getDefaultModel(): string {
        return cfg<string>('geminiModel', AVAILABLE_MODELS[0].id);
    }

    listModels(): typeof AVAILABLE_MODELS {
        return AVAILABLE_MODELS;
    }

    /**
     * Streams a chat response from Gemini.
     * Converts our message format to Gemini's expected format.
     */
    async *chatStream(messages: GeminiMessage[], options: GeminiOptions = {}, signal?: AbortSignal): AsyncGenerator<string> {
        const client = this.getClient();
        const model = options.model ?? this.getDefaultModel();

        // Separate system instruction from conversation history
        const systemInstruction = messages
            .filter(m => m.role === 'system')
            .map(m => m.content)
            .join('\n\n');

        // Convert to Gemini content format (user/model roles only)
        const contents = messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'assistant' ? 'model' as const : 'user' as const,
                parts: [{ text: m.content }]
            }));

        // Ensure conversation starts with a user message
        if (contents.length === 0 || contents[0].role !== 'user') {
            contents.unshift({ role: 'user', parts: [{ text: '(start)' }] });
        }

        try {
            const stream = await client.models.generateContentStream({
                model,
                contents,
                config: {
                    systemInstruction: systemInstruction || undefined,
                    temperature: options.temperature ?? cfg<number>('temperature', 0.7),
                    maxOutputTokens: options.maxTokens ?? 16384,
                }
            });

            for await (const chunk of stream) {
                if (signal?.aborted) {
                    logInfo('Gemini stream aborted by user');
                    const err = new Error('Aborted');
                    err.name = 'AbortError';
                    throw err;
                }

                // Handle thinking model output
                const part = chunk.candidates?.[0]?.content?.parts?.[0];
                if (part?.thought) {
                    yield '<think>' + (part.text || '') + '</think>';
                } else if (part?.text) {
                    yield part.text;
                } else {
                    // Fallback: direct text on chunk
                    const text = chunk.text;
                    if (text) {
                        yield text;
                    }
                }
            }
        } catch (error: any) {
            if (signal?.aborted) {
                logInfo('Gemini request aborted');
                const err = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }
            logError('Gemini stream error', error);
            throw error;
        }
    }

    /**
     * Non-streaming generation for tool calls / background tasks.
     */
    async generate(prompt: string, options: GeminiOptions = {}): Promise<string> {
        const client = this.getClient();
        const model = options.model ?? this.getDefaultModel();

        const response = await client.models.generateContent({
            model,
            contents: prompt,
            config: {
                temperature: options.temperature ?? 0.2,
                maxOutputTokens: options.maxTokens ?? 4096,
            }
        });

        return response.text ?? '';
    }
}
