import * as vscode from 'vscode';
import { logInfo, logError } from '../utils/logger';

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface OllamaOptions {
    model?: string;
    temperature?: number;
    num_ctx?: number;
}

const MODEL_LIST_TIMEOUT_MS = 3000;

export class OllamaClient {
    private get baseUrl(): string {
        const configured = vscode.workspace
            .getConfiguration('aether')
            .get<string>('ollamaBaseUrl', 'http://localhost:11434');

        return `${configured.replace(/\/$/, '')}/api`;
    }

    private get defaultModel(): string | undefined {
        return vscode.workspace.getConfiguration('aether').get<string>('defaultModel');
    }

    /**
     * Lists available models on the local Ollama instance.
     */
    async listModels(): Promise<string[]> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
        try {
            const response = await fetch(`${this.baseUrl}/tags`, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`Failed to list models: ${response.statusText}`);
            }
            const data = await response.json() as { models: Array<{ name: string }> };
            const models = data.models
                .map(m => m.name)
                .sort((a, b) => a.localeCompare(b));
            logInfo(`Ollama discovered ${models.length} local models`);
            return models;
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                logInfo('Ollama model list timed out — server may be offline');
            } else {
                logError('Ollama Client Error (listModels)', error);
            }
            return [];
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Generates a streaming response for the chat UI.
     * Supports cancellation via AbortSignal.
     */
    async *chatStream(messages: OllamaMessage[], options: OllamaOptions, signal?: AbortSignal): AsyncGenerator<string> {
        const payload = {
            model: options.model || this.defaultModel,
            messages,
            stream: true,
            options: {
                temperature: options.temperature ?? this.getTemperature(0.7),
                num_ctx: options.num_ctx ?? this.getContextWindow()
            }
        };

        if (!payload.model) {
            throw new Error('No Ollama model selected. Pull a local model, for example `ollama pull llama3.2`, then refresh Aether.');
        }

        const response = await fetch(`${this.baseUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal
        });

        if (!response.ok) {
            throw new Error(`Ollama chat failed: ${response.statusText}`);
        }
        
        if (!response.body) {
            throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                if (signal?.aborted) {
                    logInfo('Ollama stream aborted by user');
                    return;
                }

                const { done, value } = await reader.read();
                if (done) { break; }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') { continue; }
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            yield parsed.message.content;
                        }
                    } catch (e) {
                        logError('Error parsing Ollama stream chunk', e);
                    }
                }
            }
            
            // Process any remaining buffer
            if (buffer.trim() !== '') {
                try {
                    const parsed = JSON.parse(buffer);
                    if (parsed.message?.content) {
                        yield parsed.message.content;
                    }
                } catch {
                    // ignore trailing incomplete chunk
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Generates a non-streaming response for tool calls / background tasks.
     */
    async generate(prompt: string, options: OllamaOptions): Promise<string> {
        const payload = {
            model: options.model || this.defaultModel,
            prompt,
            stream: false,
            options: {
                temperature: options.temperature ?? this.getTemperature(0.2),
                num_ctx: options.num_ctx ?? this.getContextWindow()
            }
        };

        if (!payload.model) {
            throw new Error('No Ollama model selected. Pull a local model, for example `ollama pull llama3.2`, then refresh Aether.');
        }

        const response = await fetch(`${this.baseUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Ollama generate failed: ${response.statusText}`);
        }

        const data = await response.json() as { response: string };
        return data.response;
    }

    /**
     * Generates embeddings for semantic search.
     */
    async generateEmbeddings(text: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text })
        });

        if (!response.ok) {
            throw new Error(`Ollama embeddings failed: ${response.statusText}`);
        }

        const data = await response.json() as { embedding: number[] };
        return data.embedding;
    }

    private getTemperature(fallback: number): number {
        return vscode.workspace.getConfiguration('aether').get<number>('temperature', fallback);
    }

    private getContextWindow(): number {
        return vscode.workspace.getConfiguration('aether').get<number>('contextWindow', 8192);
    }
}
