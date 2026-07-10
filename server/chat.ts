/**
 * "Ask Aurum" — a chat assistant that can read the user's finances.
 *
 * Rather than redefine the tools, this drives the EXISTING MCP server
 * (server/mcp.ts) in-process over an in-memory transport, then re-describes
 * its tools to the Claude API. One definition, two consumers: external MCP
 * clients over POST /mcp, and this chat over POST /api/ai/chat.
 *
 * READ-ONLY BY DESIGN. Only tools the MCP server annotates `readOnlyHint` are
 * offered to the model, so a stray tool call can never mutate or delete the
 * user's financial records. Writing (adding transactions, paying bills) stays
 * in the app's own UI, where it's confirmable and undoable.
 *
 * The agentic loop is written out by hand rather than using the SDK's beta
 * tool runner: we need to cap the number of steps and report the tools that
 * ran back to the UI, and the loop is short enough that owning it is simpler.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './mcp';
import { client as aiClient, textOf } from './ai';
import type { DataService } from './data-service';

/** Tool-call rounds before we stop and answer with what we have. */
const MAX_STEPS = 8;
const MAX_TOKENS = 4096;
/** Chat turns kept; older ones are dropped to bound the prompt. */
const MAX_HISTORY = 20;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReply {
  reply: string;
  /** Tools the model ran, in order — surfaced in the UI as provenance. */
  toolsUsed: string[];
  truncated: boolean;
}

const SYSTEM = `You are Aurum's built-in finance assistant, answering questions about the user's own financial records.

Use the tools to look things up — never guess at balances, totals or dates. Call get_overview first in a new conversation: it gives you their accounts, categories, budgets, bills and goals, and the ids the other tools need. Today's date comes from get_overview.

You can only READ their data. If they ask you to add, change or delete something, explain that you can't yet and point them at the relevant page in the app.

Answer like a sharp friend who happens to know their finances: lead with the number or the answer, then the context that explains it. Keep it short — a couple of sentences unless they asked for a breakdown. Format money the way the overview reports the currency. Never invent a figure you didn't read from a tool; if the data isn't there, say so.`;

/** An MCP client wired straight to our own server — no sockets, no HTTP. */
async function connectMcp(service: DataService): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(service);
  const mcp = new Client({ name: 'aurum-chat', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

/** MCP tool results are content blocks; the model only needs their text. */
function resultText(result: any): string {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
  return text || '(no output)';
}

export async function chat(service: DataService, history: ChatMessage[]): Promise<ChatReply> {
  const turns = history.filter((m) => m.content.trim()).slice(-MAX_HISTORY);
  // The API requires the first message to be a user turn; a capped slice of a
  // long conversation can start mid-exchange on an assistant reply.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length) throw new Error('Ask a question first.');

  const { anthropic, model } = await aiClient(service);
  const mcp = await connectMcp(service);

  try {
    const listed = await mcp.listTools();
    const tools: Anthropic.Tool[] = listed.tools
      .filter((t) => (t.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint)
      .map((t) => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));

    const messages: Anthropic.MessageParam[] = turns.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const toolsUsed: string[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        return { reply: textOf(response), toolsUsed, truncated: false };
      }

      messages.push({ role: 'assistant', content: response.content });

      // Run every tool the model asked for, and return all results in ONE user
      // message — splitting them teaches the model to stop calling in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolsUsed.push(block.name);
        try {
          const out = await mcp.callTool({
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          });
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText(out),
            is_error: !!out.isError,
          });
        } catch (err) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: err instanceof Error ? err.message : 'Tool failed',
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    // Out of steps: ask for a plain answer using whatever it has gathered.
    // `tools` must still be sent — the history contains tool_use/tool_result
    // blocks, which the API rejects without definitions; tool_choice: none is
    // what actually forces a text answer.
    const final = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools,
      tool_choice: { type: 'none' },
      messages: [...messages, { role: 'user', content: 'Answer now with what you have.' }],
    });
    return { reply: textOf(final), toolsUsed, truncated: true };
  } finally {
    await mcp.close().catch(() => {});
  }
}
