import * as vscode from 'vscode';
import { AVAILABLE_MODELS, GeminiClient } from './gemini';
import { OllamaClient } from './ollama';
import { logInfo, logError } from '../utils/logger';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelProvider = 'gemini' | 'ollama';
export type ModelOption = { id: string; label: string; provider: ModelProvider };
export type SelectedModel = { provider: ModelProvider; model: string; value: string };

const MODEL_CACHE_MS = 15_000;
const GEMINI_MODEL_PREFIX = 'gemini::';
const OLLAMA_MODEL_PREFIX = 'ollama::';
const GEMINI_MODEL_IDS = new Set(AVAILABLE_MODELS.map(model => model.id));

export class ModelRouter {
    private readonly geminiClient = new GeminiClient();
    private readonly ollamaClient = new OllamaClient();
    private modelCache?: { expiresAt: number; models: ModelOption[]; defaultModel: string };
    private modelLoad?: Promise<{ models: ModelOption[]; defaultModel: string }>;

    /** Currently active AbortController — cancelled when the user stops generation. */
    private _activeAbort?: AbortController;

    async listModels(): Promise<{ models: ModelOption[]; defaultModel: string }> {
        const now = Date.now();
        if (this.modelCache && this.modelCache.expiresAt > now) {
            return this.modelCache;
        }

        if (!this.modelLoad) {
            this.modelLoad = this.loadModels().finally(() => {
                this.modelLoad = undefined;
            });
        }

        return this.modelLoad;
    }

    async resolve(model?: string): Promise<SelectedModel> {
        const explicit = this.resolveExplicitModel(model);
        if (explicit) {
            return explicit;
        }

        const { defaultModel } = await this.listModels();
        return this.resolveExplicitModel(defaultModel) ?? this.configuredGeminiSelection();
    }

    /**
     * Streams a chat completion. Returns an AsyncGenerator of string chunks.
     * Creates an internal AbortController that can be cancelled via `abort()`.
     */
    chatStream(messages: LlmMessage[], selectedModel: SelectedModel): AsyncGenerator<string> {
        this._activeAbort?.abort();
        this._activeAbort = new AbortController();
        const signal = this._activeAbort.signal;

        logInfo(`Streaming via ${selectedModel.provider}: ${selectedModel.model}`);

        if (selectedModel.provider === 'ollama') {
            return this.ollamaClient.chatStream(messages, { model: selectedModel.model }, signal);
        }

        return this.geminiClient.chatStream(messages, { model: selectedModel.model }, signal);
    }

    /** Aborts the currently active chat stream, if any. */
    abort(): void {
        if (this._activeAbort) {
            logInfo('User aborted generation');
            this._activeAbort.abort();
            this._activeAbort = undefined;
        }
    }

    /** Invalidates the model cache so the next listModels() call fetches fresh data. */
    invalidateCache(): void {
        this.modelCache = undefined;
    }

    private async loadModels(): Promise<{ models: ModelOption[]; defaultModel: string }> {
        // Gemini cloud models
        const geminiModels: ModelOption[] = AVAILABLE_MODELS.map(m => ({
            id: `${GEMINI_MODEL_PREFIX}${m.id}`,
            label: m.label,
            provider: 'gemini' as const
        }));

        // Local Ollama models
        let localModelNames: string[] = [];
        try {
            localModelNames = await this.ollamaClient.listModels();
        } catch (error) {
            logError('Failed to list Ollama models', error);
        }

        const localModels: ModelOption[] = localModelNames.map(name => ({
            id: `${OLLAMA_MODEL_PREFIX}${name}`,
            label: `Local: ${name}`,
            provider: 'ollama' as const
        }));

        this.modelCache = {
            expiresAt: Date.now() + MODEL_CACHE_MS,
            models: [...geminiModels, ...localModels],
            defaultModel: this.defaultModelValue(localModelNames)
        };

        logInfo(`Loaded ${geminiModels.length} Gemini + ${localModels.length} local models`);
        return this.modelCache;
    }

    private defaultModelValue(localModels: string[]): string {
        // If user configured a specific local model, prefer it
        const configuredLocal = cfg<string>('defaultModel', '').trim();
        if (configuredLocal && localModels.includes(configuredLocal)) {
            return `${OLLAMA_MODEL_PREFIX}${configuredLocal}`;
        }

        // If Gemini API key is set, default to configured Gemini model
        const geminiApiKey = cfg<string>('geminiApiKey', '').trim();
        if (geminiApiKey) {
            return this.configuredGeminiOption().id;
        }

        // Fall back to first local model if available
        if (localModels.length > 0) {
            return `${OLLAMA_MODEL_PREFIX}${localModels[0]}`;
        }

        // Ultimate fallback: Gemini (will prompt for key when used)
        return this.configuredGeminiOption().id;
    }

    private resolveExplicitModel(model?: string): SelectedModel | undefined {
        if (model?.startsWith(OLLAMA_MODEL_PREFIX)) {
            const modelName = model.slice(OLLAMA_MODEL_PREFIX.length);
            return modelName ? { provider: 'ollama', model: modelName, value: model } : undefined;
        }

        if (model?.startsWith(GEMINI_MODEL_PREFIX)) {
            const modelName = model.slice(GEMINI_MODEL_PREFIX.length);
            return this.knownGeminiSelection(modelName);
        }

        return model ? this.knownGeminiSelection(model) : undefined;
    }

    private knownGeminiSelection(model: string): SelectedModel | undefined {
        if (!GEMINI_MODEL_IDS.has(model)) {
            return undefined;
        }

        return {
            provider: 'gemini',
            model,
            value: `${GEMINI_MODEL_PREFIX}${model}`
        };
    }

    private configuredGeminiSelection(): SelectedModel {
        const model = this.configuredGeminiModel();
        return {
            provider: 'gemini',
            model,
            value: `${GEMINI_MODEL_PREFIX}${model}`
        };
    }

    private configuredGeminiOption(): ModelOption {
        const configuredModel = this.configuredGeminiModel();
        const configuredInfo = AVAILABLE_MODELS.find(model => model.id === configuredModel);

        return {
            id: `${GEMINI_MODEL_PREFIX}${configuredModel}`,
            label: configuredInfo?.label ?? `Gemini: ${configuredModel}`,
            provider: 'gemini'
        };
    }

    private configuredGeminiModel(): string {
        const configuredModel = cfg<string>('geminiModel', AVAILABLE_MODELS[0].id);
        return GEMINI_MODEL_IDS.has(configuredModel) ? configuredModel : AVAILABLE_MODELS[0].id;
    }
}

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('aether').get<T>(key, fallback);
}
