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
const nvidia_1 = require("./nvidia");
const ollama_1 = require("./ollama");
const MODEL_CACHE_MS = 10000;
const NVIDIA_MODEL_PREFIX = 'nvidia::';
const OLLAMA_MODEL_PREFIX = 'ollama::';
const NVIDIA_MODEL_IDS = new Set(nvidia_1.AVAILABLE_MODELS.map(model => model.id));
class ModelRouter {
    nvidiaClient = new nvidia_1.NvidiaClient();
    ollamaClient = new ollama_1.OllamaClient();
    modelCache;
    modelLoad;
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
        return this.resolveExplicitModel(defaultModel) ?? this.configuredNvidiaSelection();
    }
    chatStream(messages, selectedModel) {
        if (selectedModel.provider === 'ollama') {
            return this.ollamaClient.chatStream(messages, { model: selectedModel.model });
        }
        return this.nvidiaClient.chatStream(messages, { model: selectedModel.model });
    }
    async loadModels() {
        const configuredNvidia = this.configuredNvidiaOption();
        const localModelNames = await this.ollamaClient.listModels();
        const localModels = localModelNames.map(name => ({
            id: `${OLLAMA_MODEL_PREFIX}${name}`,
            label: `Local Llama/Ollama: ${name}`,
            provider: 'ollama'
        }));
        this.modelCache = {
            expiresAt: Date.now() + MODEL_CACHE_MS,
            models: [...localModels, configuredNvidia],
            defaultModel: this.defaultModelValue(localModelNames)
        };
        return this.modelCache;
    }
    defaultModelValue(localModels) {
        const configuredLocal = cfg('defaultModel', '').trim();
        if (configuredLocal && localModels.includes(configuredLocal)) {
            return `${OLLAMA_MODEL_PREFIX}${configuredLocal}`;
        }
        const nvidiaApiKey = cfg('nvidiaApiKey', '').trim();
        if (!nvidiaApiKey && localModels.length > 0) {
            return `${OLLAMA_MODEL_PREFIX}${localModels[0]}`;
        }
        return this.configuredNvidiaOption().id;
    }
    resolveExplicitModel(model) {
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
    knownNvidiaSelection(model) {
        if (!NVIDIA_MODEL_IDS.has(model)) {
            return undefined;
        }
        return {
            provider: 'nvidia',
            model,
            value: `${NVIDIA_MODEL_PREFIX}${model}`
        };
    }
    configuredNvidiaSelection() {
        const model = this.configuredNvidiaModel();
        return {
            provider: 'nvidia',
            model,
            value: `${NVIDIA_MODEL_PREFIX}${model}`
        };
    }
    configuredNvidiaOption() {
        const configuredModel = this.configuredNvidiaModel();
        const configuredInfo = nvidia_1.AVAILABLE_MODELS.find(model => model.id === configuredModel);
        return {
            id: `${NVIDIA_MODEL_PREFIX}${configuredModel}`,
            label: configuredInfo?.label ?? `Configured NVIDIA: ${configuredModel}`,
            provider: 'nvidia'
        };
    }
    configuredNvidiaModel() {
        const configuredModel = cfg('nvidiaModel', nvidia_1.AVAILABLE_MODELS[0].id);
        return NVIDIA_MODEL_IDS.has(configuredModel) ? configuredModel : nvidia_1.AVAILABLE_MODELS[0].id;
    }
}
exports.ModelRouter = ModelRouter;
function cfg(key, fallback) {
    return vscode.workspace.getConfiguration('aether').get(key, fallback);
}
//# sourceMappingURL=modelRouter.js.map