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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NvidiaClient = exports.AVAILABLE_MODELS = exports.NVIDIA_BASE_URL = void 0;
const openai_1 = __importDefault(require("openai"));
const vscode = __importStar(require("vscode"));
exports.NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
/** Supported NVIDIA NIM models. Only the configured model is shown in the chat selector. */
exports.AVAILABLE_MODELS = [
    { id: 'z-ai/glm-5.1', label: 'GLM 5.1 (ZML thinking)', supportsThinking: true },
    { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1 (reasoning)', supportsThinking: true },
    { id: 'deepseek-ai/deepseek-v3', label: 'DeepSeek V3', supportsThinking: false },
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', supportsThinking: false },
    { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct', supportsThinking: false },
    { id: 'mistralai/mistral-large-2-instruct', label: 'Mistral Large 2', supportsThinking: false },
    { id: 'mistralai/mixtral-8x22b-instruct-v0.1', label: 'Mixtral 8x22B', supportsThinking: false },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B (NVIDIA)', supportsThinking: false },
    { id: 'google/gemma-3-27b-it', label: 'Gemma 3 27B', supportsThinking: false },
    { id: 'microsoft/phi-3-medium-128k-instruct', label: 'Phi-3 Medium 128K', supportsThinking: false },
    { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', supportsThinking: false },
];
const AVAILABLE_MODELS_BY_ID = new Map(exports.AVAILABLE_MODELS.map(model => [model.id, model]));
function cfg(key, fallback) {
    return vscode.workspace.getConfiguration('aether').get(key, fallback);
}
class NvidiaClient {
    client;
    clientApiKey;
    /**
     * Reuses the OpenAI client until the configured API key changes.
     * This keeps settings hot-reload behavior without rebuilding the client every request.
     */
    getClient() {
        const apiKey = cfg('nvidiaApiKey', '').trim();
        if (!apiKey) {
            throw new Error('NVIDIA API key is not set. Open Settings > Aether > Nvidia Api Key and paste your key from build.nvidia.com.');
        }
        if (!this.client || this.clientApiKey !== apiKey) {
            this.client = new openai_1.default({ apiKey, baseURL: exports.NVIDIA_BASE_URL });
            this.clientApiKey = apiKey;
        }
        return this.client;
    }
    getDefaultModel() {
        return cfg('nvidiaModel', exports.AVAILABLE_MODELS[0].id);
    }
    listModels() {
        return exports.AVAILABLE_MODELS;
    }
    modelSupportsThinking(modelId) {
        return AVAILABLE_MODELS_BY_ID.get(modelId)?.supportsThinking ?? false;
    }
    async *chatStream(messages, options = {}) {
        const client = this.getClient();
        const model = options.model ?? this.getDefaultModel();
        const useThinking = this.modelSupportsThinking(model);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = await client.chat.completions.create({
            model,
            messages,
            temperature: options.temperature ?? cfg('temperature', 0.7),
            top_p: 1,
            max_tokens: options.maxTokens ?? 16384,
            ...(useThinking ? { chat_template_kwargs: { enable_thinking: true, clear_thinking: false } } : {}),
            stream: true,
        });
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.reasoning_content) {
                yield `<think>${delta.reasoning_content}</think>`;
            }
            if (delta?.content) {
                yield delta.content;
            }
        }
    }
    async generate(prompt, options = {}) {
        const client = this.getClient();
        const model = options.model ?? this.getDefaultModel();
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
exports.NvidiaClient = NvidiaClient;
//# sourceMappingURL=nvidia.js.map