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
exports.ModelRouter = void 0;
const vscode = __importStar(require("vscode"));
const gemini_1 = require("./gemini");
const ollama_1 = require("./ollama");
const logger_1 = require("../utils/logger");
const MODEL_CACHE_MS = 15_000;
const GEMINI_MODEL_PREFIX = 'gemini::';
const OLLAMA_MODEL_PREFIX = 'ollama::';
const GEMINI_MODEL_IDS = new Set(gemini_1.AVAILABLE_MODELS.map(model => model.id));
class ModelRouter {
    geminiClient = new gemini_1.GeminiClient();
    ollamaClient = new ollama_1.OllamaClient();
    modelCache;
    modelLoad;
    /** Currently active AbortController — cancelled when the user stops generation. */
    _activeAbort;
    async listModels() {
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
    async resolve(model) {
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
    chatStream(messages, selectedModel) {
        this._activeAbort?.abort();
        this._activeAbort = new AbortController();
        const signal = this._activeAbort.signal;
        (0, logger_1.logInfo)(`Streaming via ${selectedModel.provider}: ${selectedModel.model}`);
        if (selectedModel.provider === 'ollama') {
            return this.ollamaClient.chatStream(messages, { model: selectedModel.model }, signal);
        }
        return this.geminiClient.chatStream(messages, { model: selectedModel.model }, signal);
    }
    /** Aborts the currently active chat stream, if any. */
    abort() {
        if (this._activeAbort) {
            (0, logger_1.logInfo)('User aborted generation');
            this._activeAbort.abort();
            this._activeAbort = undefined;
        }
    }
    /** Invalidates the model cache so the next listModels() call fetches fresh data. */
    invalidateCache() {
        this.modelCache = undefined;
    }
    async loadModels() {
        // Gemini cloud models
        const geminiModels = gemini_1.AVAILABLE_MODELS.map(m => ({
            id: `${GEMINI_MODEL_PREFIX}${m.id}`,
            label: m.label,
            provider: 'gemini'
        }));
        // Local Ollama models
        let localModelNames = [];
        try {
            localModelNames = await this.ollamaClient.listModels();
        }
        catch (error) {
            (0, logger_1.logError)('Failed to list Ollama models', error);
        }
        const localModels = localModelNames.map(name => ({
            id: `${OLLAMA_MODEL_PREFIX}${name}`,
            label: `Local: ${name}`,
            provider: 'ollama'
        }));
        this.modelCache = {
            expiresAt: Date.now() + MODEL_CACHE_MS,
            models: [...geminiModels, ...localModels],
            defaultModel: this.defaultModelValue(localModelNames)
        };
        (0, logger_1.logInfo)(`Loaded ${geminiModels.length} Gemini + ${localModels.length} local models`);
        return this.modelCache;
    }
    defaultModelValue(localModels) {
        // If user configured a specific local model, prefer it
        const configuredLocal = cfg('defaultModel', '').trim();
        if (configuredLocal && localModels.includes(configuredLocal)) {
            return `${OLLAMA_MODEL_PREFIX}${configuredLocal}`;
        }
        // If Gemini API key is set, default to configured Gemini model
        const geminiApiKey = cfg('geminiApiKey', '').trim();
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
    resolveExplicitModel(model) {
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
    knownGeminiSelection(model) {
        if (!GEMINI_MODEL_IDS.has(model)) {
            return undefined;
        }
        return {
            provider: 'gemini',
            model,
            value: `${GEMINI_MODEL_PREFIX}${model}`
        };
    }
    configuredGeminiSelection() {
        const model = this.configuredGeminiModel();
        return {
            provider: 'gemini',
            model,
            value: `${GEMINI_MODEL_PREFIX}${model}`
        };
    }
    configuredGeminiOption() {
        const configuredModel = this.configuredGeminiModel();
        const configuredInfo = gemini_1.AVAILABLE_MODELS.find(model => model.id === configuredModel);
        return {
            id: `${GEMINI_MODEL_PREFIX}${configuredModel}`,
            label: configuredInfo?.label ?? `Gemini: ${configuredModel}`,
            provider: 'gemini'
        };
    }
    configuredGeminiModel() {
        const configuredModel = cfg('geminiModel', gemini_1.AVAILABLE_MODELS[0].id);
        return GEMINI_MODEL_IDS.has(configuredModel) ? configuredModel : gemini_1.AVAILABLE_MODELS[0].id;
    }
}
exports.ModelRouter = ModelRouter;
function cfg(key, fallback) {
    return vscode.workspace.getConfiguration('aether').get(key, fallback);
}
//# sourceMappingURL=modelRouter.js.map