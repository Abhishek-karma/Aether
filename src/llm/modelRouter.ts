import * as vscode from 'vscode';
import { AVAILABLE_MODELS, NvidiaClient } from './nvidia';
import { OllamaClient } from './ollama';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelProvider = 'nvidia' | 'ollama';
export type ModelOption = { id: string; label: string; provider: ModelProvider };
export type SelectedModel = { provider: ModelProvider; model: string; value: string };

const MODEL_CACHE_MS = 10000;
const NVIDIA_MODEL_PREFIX = 'nvidia::';
const OLLAMA_MODEL_PREFIX = 'ollama::';
const NVIDIA_MODEL_IDS = new Set(AVAILABLE_MODELS.map(model => model.id));

export class ModelRouter {
    private readonly nvidiaClient = new NvidiaClient();
    private readonly ollamaClient = new OllamaClient();
    private modelCache?: { expiresAt: number; models: ModelOption[]; defaultModel: string };
    private modelLoad?: Promise<{ models: ModelOption[]; defaultModel: string }>;

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
        return this.resolveExplicitModel(defaultModel) ?? this.configuredNvidiaSelection();
    }

    chatStream(messages: LlmMessage[], selectedModel: SelectedModel): AsyncGenerator<string> {
        if (selectedModel.provider === 'ollama') {
            return this.ollamaClient.chatStream(messages, { model: selectedModel.model });
        }

        return this.nvidiaClient.chatStream(messages, { model: selectedModel.model });
    }

    private async loadModels(): Promise<{ models: ModelOption[]; defaultModel: string }> {
        const configuredNvidia = this.configuredNvidiaOption();
        const localModelNames = await this.ollamaClient.listModels();
        const localModels = localModelNames.map(name => ({
            id: `${OLLAMA_MODEL_PREFIX}${name}`,
            label: `Local Llama/Ollama: ${name}`,
            provider: 'ollama' as const
        }));

        this.modelCache = {
            expiresAt: Date.now() + MODEL_CACHE_MS,
            models: [...localModels, configuredNvidia],
            defaultModel: this.defaultModelValue(localModelNames)
        };
        return this.modelCache;
    }

    private defaultModelValue(localModels: string[]): string {
        const configuredLocal = cfg<string>('defaultModel', '').trim();
        if (configuredLocal && localModels.includes(configuredLocal)) {
            return `${OLLAMA_MODEL_PREFIX}${configuredLocal}`;
        }

        const nvidiaApiKey = cfg<string>('nvidiaApiKey', '').trim();
        if (!nvidiaApiKey && localModels.length > 0) {
            return `${OLLAMA_MODEL_PREFIX}${localModels[0]}`;
        }

        return this.configuredNvidiaOption().id;
    }

    private resolveExplicitModel(model?: string): SelectedModel | undefined {
        if (model?.startsWith(OLLAMA_MODEL_PREFIX)) {
            const modelName = model.slice(OLLAMA_MODEL_PREFIX.length);
            return modelName ? { provider: 'ollama', model: modelName, value: model } : undefined;
        }

        if (model?.startsWith(NVIDIA_MODEL_PREFIX)) {
            const modelName = model.slice(NVIDIA_MODEL_PREFIX.length);
            return this.knownNvidiaSelection(modelName);
        }

        return model ? this.knownNvidiaSelection(model) : undefined;
    }

    private knownNvidiaSelection(model: string): SelectedModel | undefined {
        if (!NVIDIA_MODEL_IDS.has(model)) {
            return undefined;
        }

        return {
            provider: 'nvidia',
            model,
            value: `${NVIDIA_MODEL_PREFIX}${model}`
        };
    }

    private configuredNvidiaSelection(): SelectedModel {
        const model = this.configuredNvidiaModel();
        return {
            provider: 'nvidia',
            model,
            value: `${NVIDIA_MODEL_PREFIX}${model}`
        };
    }

    private configuredNvidiaOption(): ModelOption {
        const configuredModel = this.configuredNvidiaModel();
        const configuredInfo = AVAILABLE_MODELS.find(model => model.id === configuredModel);

        return {
            id: `${NVIDIA_MODEL_PREFIX}${configuredModel}`,
            label: configuredInfo?.label ?? `Configured NVIDIA: ${configuredModel}`,
            provider: 'nvidia'
        };
    }

    private configuredNvidiaModel(): string {
        const configuredModel = cfg<string>('nvidiaModel', AVAILABLE_MODELS[0].id);
        return NVIDIA_MODEL_IDS.has(configuredModel) ? configuredModel : AVAILABLE_MODELS[0].id;
    }
}

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('aether').get<T>(key, fallback);
}
