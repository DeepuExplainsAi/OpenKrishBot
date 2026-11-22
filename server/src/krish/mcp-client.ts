import { appTools, findAppTool } from '../apps.js';

/** Connected apps (MCP servers on this computer + web APIs), as tools for the OpenKrishBot engine. */
export interface ExtraTool { name: string; description: string; inputSchema: any }
export async function extraTools(_botId: string): Promise<ExtraTool[]> {
  return (await appTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
export async function callExtraTool(_botId: string, name: string, args: unknown): Promise<string> {
  const t = await findAppTool(name);
  if (!t) return JSON.stringify({ error: `Unknown tool ${name}` });
  return t.run(args);
}
