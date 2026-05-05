"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
const vscode = __importStar(require("vscode"));
const MODEL_LIST_TIMEOUT_MS = 1500;
class OllamaClient {
    get baseUrl() {
        const configured = vscode.workspace
            .getConfiguration('aether')
            .get('ollamaBaseUrl', 'http://localhost:11434');
        return `${configured.replace(/\/$/, '')}/api`;
    }
    get defaultModel() {
        return vscode.workspace.getConfiguration('aether').get('defaultModel');
    }
    /**
     * Lists available models on the local Ollama instance
     */
    async listModels() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
        try {
            const response = await fetch(`${this.baseUrl}/tags`, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`Failed to list models: ${response.statusText}`);
            }
            const data = await response.json();
            return data.models
                .map(m => m.name)
                .sort((a, b) => a.localeCompare(b));
        }
        catch (error) {
            console.error('Ollama Client Error (listModels):', error);
            return [];
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /**
     * Generates a streaming response for the chat UI
     */
    async *chatStream(messages, options) {
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
    getTemperature(fallback) {
        return vscode.workspace.getConfiguration('aether').get('temperature', fallback);
    }
    getContextWindow() {
        return vscode.workspace.getConfiguration('aether').get('contextWindow', 8192);
    }
}
exports.OllamaClient = OllamaClient;
//# sourceMappingURL=ollama.js.map