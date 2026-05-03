"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
class OllamaClient {
    baseUrl = 'http://localhost:11434/api';
    /**
     * Lists available models on the local Ollama instance
     */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/tags`);
            if (!response.ok) {
                throw new Error(`Failed to list models: ${response.statusText}`);
            }
            const data = await response.json();
            return data.models.map(m => m.name);
        }
        catch (error) {
            console.error('Ollama Client Error (listModels):', error);
            return [];
        }
    }
    /**
     * Generates a streaming response for the chat UI
     */
    async *chatStream(messages, options) {
        const payload = {
            model: options.model,
            messages,
            stream: true,
            options: {
                temperature: options.temperature ?? 0.7,
                num_ctx: options.num_ctx ?? 4096
            }
        };
        const response = await fetch(`${this.baseUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim() === '')
                        continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            yield parsed.message.content;
                        }
                    }
                    catch (e) {
                        console.error('Error parsing Ollama stream chunk:', e, 'Line:', line);
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
                }
                catch (e) {
                    // ignore
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    /**
     * Generates a non-streaming response for tool calls / background tasks
     */
    async generate(prompt, options) {
        const payload = {
            model: options.model,
            prompt,
            stream: false,
            options: {
                temperature: options.temperature ?? 0.2,
                num_ctx: options.num_ctx ?? 4096
            }
        };
        const response = await fetch(`${this.baseUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Ollama generate failed: ${response.statusText}`);
        }
        const data = await response.json();
        return data.response;
    }
    /**
     * Generates embeddings for semantic search
     */
    async generateEmbeddings(text, model = 'nomic-embed-text') {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text })
        });
        if (!response.ok) {
            throw new Error(`Ollama embeddings failed: ${response.statusText}`);
        }
        const data = await response.json();
        return data.embedding;
    }
}
exports.OllamaClient = OllamaClient;
//# sourceMappingURL=ollama.js.map