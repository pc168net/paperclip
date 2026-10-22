import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterModel,
  AdapterSessionCodec,
  ServerAdapterModule,
} from "@paperclipai/adapter-utils";
import { aiProviderRoutingSchema } from "@paperclipai/shared";
import {
  joinPromptSections,
  parseObject,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
} from "@paperclipai/adapter-utils/server-utils";
import { testCustomEnvironment } from "./custom-local-test.js";

const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    const value = parseObject(raw);
    return typeof value.responseId === "string" && value.responseId.trim()
      ? { responseId: value.responseId.trim() }
      : null;
  },
  serialize(params) {
    const responseId = typeof params?.responseId === "string" ? params.responseId.trim() : "";
    return responseId ? { responseId } : null;
  },
  getDisplayId(params) {
    return typeof params?.responseId === "string" && params.responseId.trim() ? params.responseId.trim() : null;
  },
};

function resolveRoute(config: Record<string, unknown>) {
  const parsed = aiProviderRoutingSchema.safeParse(config.managedAiRouting);
  if (!parsed.success || parsed.data.kind !== "gateway") {
    throw new Error("Custom runner requires a configured gateway endpoint.");
  }
  if (parsed.data.protocol !== "responses" && parsed.data.protocol !== "chat") {
    throw new Error("Custom runner supports only Responses and Chat Completions protocols.");
  }
  const baseUrl = parsed.data.baseUrl?.replace(/\/+$/, "") ?? "";
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Custom endpoint must use HTTPS (or a loopback HTTP endpoint).");
  }
  return { ...parsed.data, baseUrl };
}

function resolveModel(config: Record<string, unknown>, route: ReturnType<typeof resolveRoute>): string {
  const managed = config.managedAiConnection && typeof config.managedAiConnection === "object"
    ? config.managedAiConnection as Record<string, unknown>
    : undefined;
  const managedModel = typeof managed?.modelId === "string" ? managed.modelId.trim() : "";
  const configured = typeof config.model === "string" ? config.model.trim() : "";
  const model = managedModel || configured || route.models[0]?.id || "";
  return model.replace(/^paperclip\//, "");
}

function resolvePrompt(ctx: AdapterExecutionContext): string {
  const selected = selectPaperclipPromptSections(ctx.context, {
    resumedSession: Boolean(ctx.context.sessionParams),
    includeCommunicationGuidance: false,
  });
  const communication = selectInitialCommunicationGuidance(ctx.context, {
    resumedSession: Boolean(ctx.context.sessionParams),
  });
  const direct = typeof ctx.context.prompt === "string" ? ctx.context.prompt.trim() : "";
  if (direct) return joinPromptSections([communication, selected.wakePrompt, direct]);
  const assignment = joinPromptSections([communication, selected.wakePrompt, selected.taskContextNote]);
  if (assignment) return assignment;
  const task = parseObject(ctx.context.task);
  const title = typeof task.title === "string" ? task.title.trim() : "";
  const description = typeof task.description === "string" ? task.description.trim() : "";
  return [title, description].filter(Boolean).join("\n\n") || "Continue the assigned work.";
}

function resolveSystemPrompt(ctx: AdapterExecutionContext): string {
  const configured = typeof ctx.context.systemPrompt === "string" ? ctx.context.systemPrompt.trim() : "";
  return configured;
}

function responseText(body: Record<string, unknown>): string {
  const output = Array.isArray(body.output) ? body.output : [];
  const responseParts = output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  });
  if (responseParts.length) return responseParts.join("");
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

function usage(body: Record<string, unknown>) {
  const value = body.usage;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const input = Number(record.input_tokens ?? record.prompt_tokens ?? 0);
  const output = Number(record.output_tokens ?? record.completion_tokens ?? 0);
  return Number.isFinite(input) && Number.isFinite(output)
    ? { inputTokens: input, outputTokens: output, totalTokens: input + output }
    : undefined;
}

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; server: string };

async function mcpRequest(server: { url: string; token: string }, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${server.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  if (!response.ok) throw new Error(`Paperclip tool server returned HTTP ${response.status}.`);
  const payload = await response.json() as { result?: Record<string, unknown>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Paperclip tool request failed.");
  return payload.result ?? {};
}

async function discoverMcpTools(ctx: AdapterExecutionContext): Promise<McpTool[]> {
  const servers = ctx.runtimeMcp?.getServers() ?? [];
  const tools: McpTool[] = [];
  for (const server of servers) {
    try {
      await mcpRequest(server, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "paperclip-custom", version: "1" } });
      const listed = await mcpRequest(server, "tools/list");
      for (const tool of Array.isArray(listed.tools) ? listed.tools : []) {
        if (!tool || typeof tool !== "object" || typeof (tool as Record<string, unknown>).name !== "string") continue;
        const value = tool as Record<string, unknown>;
        tools.push({ name: value.name as string, description: typeof value.description === "string" ? value.description : undefined, inputSchema: parseObject(value.inputSchema), server: server.name });
      }
    } catch {
      // A provider can still complete a turn when an optional MCP server is unavailable.
    }
  }
  return tools;
}

async function callMcpTool(ctx: AdapterExecutionContext, tool: McpTool, args: Record<string, unknown>) {
  const server = (ctx.runtimeMcp?.getServers() ?? []).find(entry => entry.name === tool.server);
  if (!server) throw new Error(`Paperclip tool server is unavailable for ${tool.name}.`);
  return mcpRequest(server, "tools/call", { name: tool.name, arguments: args });
}

export async function executeCustom(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let route: ReturnType<typeof resolveRoute>;
  try {
    route = resolveRoute(ctx.config);
  } catch (error) {
    return { exitCode: 1, signal: null, timedOut: false, errorCode: "custom_configuration_invalid", errorMessage: error instanceof Error ? error.message : String(error) };
  }

  const model = resolveModel(ctx.config, route);
  if (!model) return { exitCode: 1, signal: null, timedOut: false, errorCode: "custom_model_missing", errorMessage: "Custom runner requires a model or deployment ID." };
  const env = parseObject(ctx.config.env);
  const credential = route.auth === "none" ? "" : typeof env.PAPERCLIP_AI_PROVIDER_KEY === "string" ? env.PAPERCLIP_AI_PROVIDER_KEY : "";
  if (route.auth !== "none" && !credential) {
    return { exitCode: 1, signal: null, timedOut: false, errorCode: "custom_credential_missing", errorMessage: "Custom runner credential is missing." };
  }
  const session = sessionCodec.deserialize(ctx.context.sessionParams);
  const input = resolvePrompt(ctx);
  const systemPrompt = resolveSystemPrompt(ctx);
  const isResponses = route.protocol === "responses";
  const endpoint = `${route.baseUrl}/${isResponses ? "responses" : "chat/completions"}`;
  const mcpTools = await discoverMcpTools(ctx);
  const tools = isResponses
    ? mcpTools.map(tool => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: "object", properties: {} } }))
    : mcpTools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: "object", properties: {} } } }));
  let requestInput: unknown = systemPrompt ? [{ role: "developer", content: systemPrompt }, { role: "user", content: input }] : input;
  let messages: Array<Record<string, unknown>> = [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: input }];
  let previousResponseId: string | null = typeof session?.responseId === "string" ? session.responseId : null;
  const controller = new AbortController();
  const timeoutSec = Number(ctx.config.timeoutSec ?? 0);
  let timedOut = false;
  const timeout = Number.isFinite(timeoutSec) && timeoutSec > 0
    ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutSec * 1000)
    : undefined;
  const abort = () => controller.abort(ctx.signal?.reason);
  if (ctx.signal?.aborted) abort();
  else ctx.signal?.addEventListener("abort", abort, { once: true });
  ctx.onDispatch?.();
  try {
    for (let turn = 0; turn < 8; turn += 1) {
      const body = isResponses
        ? { model, input: requestInput, ...(previousResponseId ? { previous_response_id: previousResponseId } : {}), ...(tools.length ? { tools } : {}), max_output_tokens: Number(ctx.config.maxOutputTokens ?? 4096) }
        : { model, messages, ...(tools.length ? { tools } : {}), max_tokens: Number(ctx.config.maxOutputTokens ?? 4096) };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(route.auth === "api_key" ? { "api-key": credential } : route.auth === "bearer" ? { authorization: `Bearer ${credential}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    const raw = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* normalized below */ }
    if (!response.ok) {
      const message = typeof parsed.error === "object" && parsed.error && typeof (parsed.error as Record<string, unknown>).message === "string"
        ? (parsed.error as Record<string, unknown>).message as string
        : `Custom provider request failed with HTTP ${response.status}.`;
      return { exitCode: 1, signal: null, timedOut: false, errorCode: response.status === 401 || response.status === 403 ? "custom_auth_failed" : response.status === 404 ? "custom_model_not_found" : response.status === 429 ? "custom_provider_rate_limited" : "custom_provider_error", errorMessage: message };
    }
      const responseId = typeof parsed.id === "string" ? parsed.id : previousResponseId;
      const calls = isResponses
        ? (Array.isArray(parsed.output) ? parsed.output : []).filter(item => item && typeof item === "object" && (item as Record<string, unknown>).type === "function_call") as Array<Record<string, unknown>>
        : (() => { const message = Array.isArray(parsed.choices) && parsed.choices[0] && typeof parsed.choices[0] === "object" ? (parsed.choices[0] as Record<string, unknown>).message : null; return message && typeof message === "object" && Array.isArray((message as Record<string, unknown>).tool_calls) ? (message as Record<string, unknown>).tool_calls as Array<Record<string, unknown>> : []; })();
      if (calls.length === 0) {
        const text = responseText(parsed);
        await ctx.onLog("stdout", `${text || "[custom] provider completed without text output."}\n`);
        return { exitCode: 0, signal: null, timedOut: false, summary: text, resultJson: parsed, sessionParams: responseId ? { responseId } : session, sessionDisplayId: responseId, model, provider: "custom", biller: "custom", usage: usage(parsed), usageBasis: "per_run" };
      }
      const outputs: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        const functionCall = isResponses ? call : parseObject(call.function);
        const name = typeof functionCall.name === "string" ? functionCall.name : "";
        const argsRaw = typeof functionCall.arguments === "string" ? functionCall.arguments : "{}";
        const tool = mcpTools.find(entry => entry.name === name);
        if (!tool) throw new Error(`Paperclip tool is unavailable: ${name}.`);
        const result = await callMcpTool(ctx, tool, parseObject(JSON.parse(argsRaw)));
        if (isResponses) outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
        else messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      previousResponseId = responseId;
      requestInput = outputs;
      if (!isResponses) {
        const message = Array.isArray(parsed.choices) && parsed.choices[0] && typeof parsed.choices[0] === "object" ? (parsed.choices[0] as Record<string, unknown>).message : null;
        if (message && typeof message === "object") messages.push(message as Record<string, unknown>);
      }
    }
    throw new Error("Custom provider exceeded the maximum tool-call continuation turns.");
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { exitCode: 1, signal: aborted ? "SIGTERM" : null, timedOut, errorCode: timedOut ? "custom_request_timeout" : aborted ? "custom_request_aborted" : "custom_provider_unreachable", errorMessage: timedOut ? "Custom provider request timed out." : aborted ? "Custom provider request was aborted." : error instanceof Error ? error.message : String(error) };
  } finally {
    if (timeout) clearTimeout(timeout);
    ctx.signal?.removeEventListener("abort", abort);
  }
}

export function customModels(config?: Record<string, unknown>): AdapterModel[] {
  const route = config ? aiProviderRoutingSchema.safeParse(config.managedAiRouting) : null;
  return route?.success ? route.data.models.map((model) => ({ id: model.id, label: model.label ?? model.id })) : [];
}

export const customLocalAdapter: ServerAdapterModule = {
  type: "custom_local",
  runtimeToolDelivery: "invocation_context",
  execute: executeCustom,
  testEnvironment: testCustomEnvironment,
  sessionCodec,
  models: [],
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: "# Custom model runner\n\nUses the configured OpenAI-compatible gateway directly.\n",
};
