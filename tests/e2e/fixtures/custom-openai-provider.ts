import { createServer, type Server } from "node:http";
import { listenOnFetchAllowedPort } from "../fetch-allowed-port";

type RequestRecord = { method: string; path: string };

/**
 * A deliberately narrow OpenAI-compatible endpoint for browser journeys. The
 * Paperclip server reaches it directly; it retains no credential or body data.
 */
export async function startCustomOpenAiProviderFixture() {
  const requests: RequestRecord[] = [];
  const server: Server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push({ method, path });

    if (method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-custom-model" }] }));
      return;
    }
    if (method === "POST" && path === "/v1/responses") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "fixture-response", output: [] }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Unsupported fixture request" }));
  });
  const port = await listenOnFetchAllowedPort(server);
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
