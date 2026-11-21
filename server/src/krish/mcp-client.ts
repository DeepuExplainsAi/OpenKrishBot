/** MCP connectors (stdio + HTTP). Filled in by part P4; until then a bot has only its built-in tools. */
export interface ExtraTool { name: string; description: string; inputSchema: any }
export async function extraTools(_botId: string): Promise<ExtraTool[]> { return []; }
export async function callExtraTool(_botId: string, name: string, _args: unknown): Promise<string> {
  return JSON.stringify({ error: `Unknown tool ${name}` });
}
