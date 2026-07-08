import fs from 'fs';
import path from 'path';

export interface ToolDefinition {
  name: string;
  description: string;
  scope: 'read' | 'draft' | 'live';
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const registry = new Map<string, ToolDefinition>();

const BUILTIN_DIR = path.join(__dirname, 'tools', 'builtin');
const GENERATED_DIR = path.join(__dirname, 'tools', 'generated');

function loadFile(fullPath: string): void {
  try {
    // Bust the require cache so hot-reload works for generated tools.
    delete require.cache[require.resolve(fullPath)];
    // tsx/ts-node handle .ts files; compiled builds use .js.
    const mod = require(fullPath) as { default?: ToolDefinition } | ToolDefinition;
    const tool = (mod as { default?: ToolDefinition }).default ?? (mod as ToolDefinition);
    if (tool?.name && typeof tool.run === 'function') {
      registry.set(tool.name, tool);
      console.log(`[oski:tools] loaded ${tool.name} (${tool.scope})`);
    }
  } catch (err) {
    console.warn(`[oski:tools] failed to load ${path.basename(fullPath)}:`, err instanceof Error ? err.message : err);
  }
}

function loadDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const exts = ['.ts', '.js'];
  const files = fs.readdirSync(dir).filter(f => exts.some(e => f.endsWith(e)));
  for (const file of files) {
    loadFile(path.join(dir, file));
  }
}

export function initRegistry(): void {
  loadDir(BUILTIN_DIR);
  loadDir(GENERATED_DIR);

  // Watch the generated dir for new tools written by the agent (codegen opt-in).
  if (fs.existsSync(GENERATED_DIR)) {
    fs.watch(GENERATED_DIR, { persistent: false }, (_event, filename) => {
      if (filename && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
        console.log(`[oski:tools] ${filename} changed — reloading generated tools...`);
        loadDir(GENERATED_DIR);
      }
    });
  }
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

// Serialize to Anthropic tool_use schema format.
export function toAnthropicTools(): Array<{
  name: string;
  description: string;
  input_schema: ToolDefinition['inputSchema'];
}> {
  return listTools().map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
