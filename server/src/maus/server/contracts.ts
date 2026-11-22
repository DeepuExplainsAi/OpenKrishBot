/** An MCP server this machine starts and talks to over stdio. */
export interface StdioMcpSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}


/** An MCP server over streamable HTTP (`http`) or the older SSE transport; header values are credentials and never go on argv. */
export interface RemoteMcpSpec {
  type: "http" | "sse";
  url: string;
  headers: Record<string, string>;
}


export type McpServerSpec = StdioMcpSpec | RemoteMcpSpec;
