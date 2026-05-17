export interface ToolResult {
    ok: boolean;
    message?: string;
    output?: string;
}

export interface ITool {
    name: string;
    description: string;
    execute(args: any): Promise<ToolResult>;
}

export class ToolRegistry {
    private tools = new Map<string, ITool>();

    register(tool: ITool) {
        this.tools.set(tool.name, tool);
    }

    get(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    getAll(): ITool[] {
        return Array.from(this.tools.values());
    }
}
