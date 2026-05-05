import OpenAI from 'openai';
import * as vscode from 'vscode';

export interface NvidiaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface NvidiaOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Full list of models available in the NVIDIA NIM catalogue. */
export const AVAILABLE_MODELS: { id: string; label: string; supportsThinking: boolean }[] = [
    { id: 'z-ai/glm-5.1',                              label: 'GLM 5.1 (ZML ✦ thinking)',         supportsThinking: true  },
    { id: 'deepseek-ai/deepseek-r1',                   label: 'DeepSeek R1 (reasoning)',           supportsThinking: true  },
    { id: 'deepseek-ai/deepseek-v3',                   label: 'DeepSeek V3',                       supportsThinking: false },
    { id: 'meta/llama-3.3-70b-instruct',               label: 'Llama 3.3 70B Instruct',           supportsThinking: false },
    { id: 'meta/llama-3.1-405b-instruct',              label: 'Llama 3.1 405B Instruct',          supportsThinking: false },
    { id: 'mistralai/mistral-large-2-instruct',        label: 'Mistral Large 2',                   supportsThinking: false },
    { id: 'mistralai/mixtral-8x22b-instruct-v0.1',    label: 'Mixtral 8x22B',                     supportsThinking: false },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct',   label: 'Nemotron 70B (NVIDIA)',             supportsThinking: false },
    { id: 'google/gemma-3-27b-it',                    label: 'Gemma 3 27B',                       supportsThinking: false },
    { id: 'microsoft/phi-3-medium-128k-instruct',     label: 'Phi-3 Medium 128K',                supportsThinking: false },
    { id: 'qwen/qwen2.5-coder-32b-instruct',          label: 'Qwen 2.5 Coder 32B',               supportsThinking: false },
];

const AVAILABLE_MODELS_BY_ID = new Map(AVAILABLE_MODELS.map(model => [model.id, model]));

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('aether').get<T>(key, fallback);
}

export class NvidiaClient {
    private client?: OpenAI;
    private clientApiKey?: string;

    /**
     * Builds a fresh OpenAI client using the currently configured API key.
     * Called per-request so key changes take effect without reloading.
     */
    private getClient(): OpenAI {
        const apiKey = cfg<string>('nvidiaApiKey', '').trim();
        if (!apiKey) {
            throw new Error(
                'NVIDIA API key is not set. Open **Settings → Aether → Nvidia Api Key** and paste your key from build.nvidia.com.'
            );
        }
        if (!this.client || this.clientApiKey !== apiKey) {
            this.client = new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
            this.clientApiKey = apiKey;
        }
        return this.client;
    }

    /** Active model from VS Code settings (can be overridden per-session via the UI). */
    getDefaultModel(): string {
        return cfg<string>('nvidiaModel', AVAILABLE_MODELS[0].id);
    }

    /** Returns the model catalogue for the UI dropdown. */
    listModels(): typeof AVAILABLE_MODELS {
        return AVAILABLE_MODELS;
    }

    /** Whether the given model emits reasoning_content tokens. */
    private modelSupportsThinking(modelId: string): boolean {
        return AVAILABLE_MODELS_BY_ID.get(modelId)?.supportsThinking ?? false;
    }

    /**
     * Streaming chat against the NVIDIA NIM endpoint.
     * Yields text chunks; reasoning tokens are wrapped in <think>…</think>.
     */
    async *chatStream(messages: NvidiaMessage[], options: NvidiaOptions = {}): AsyncGenerator<string> {
        const client = this.getClient();
        const model  = options.model ?? this.getDefaultModel();
        const useThinking = this.modelSupportsThinking(model);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await (client.chat.completions.create as any)({
            model,
            messages,
            temperature: options.temperature ?? cfg<number>('temperature', 0.7),
            top_p: 1,
            max_tokens: options.maxTokens ?? 16384,
            ...(useThinking ? { chat_template_kwargs: { enable_thinking: true, clear_thinking: false } } : {}),
            stream: true,
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta as {
                content?: string;
                reasoning_content?: string; // NVIDIA extension
            };

            if (delta?.reasoning_content) {
                yield `<think>${delta.reasoning_content}</think>`;
            }
            if (delta?.content) {
                yield delta.content;
            }
        }
    }

    /**
     * Non-streaming single-turn generation (tool results, background tasks).
     */
    async generate(prompt: string, options: NvidiaOptions = {}): Promise<string> {
        const client = this.getClient();
        const model  = options.model ?? this.getDefaultModel();

        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 4096,
            stream: false,
        });

        return completion.choices[0]?.message?.content ?? '';
    }
}
