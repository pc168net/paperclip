import { expect, test, type APIRequestContext } from "@playwright/test";
import { startCustomOpenAiProviderFixture } from "./fixtures/custom-openai-provider";

type Company = { id: string; issuePrefix: string; name: string };
type Agent = { id: string; urlKey?: string; runtimeConfig: { aiConnection?: unknown } };

// This journey enters a synthetic credential in the browser. Never retain a
// screenshot, trace, or video from the credential/configuration surface.
test.use({ screenshot: "off", trace: "off", video: "off" });

async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), `${response.url()} failed with ${response.status()}`).toBe(true);
  return await response.json() as T;
}

test.describe("Custom first-agent Connector journey", () => {
  test("creates, verifies, binds, and assigns a Custom deployment", async ({ page, request }) => {
    const provider = await startCustomOpenAiProviderFixture();
    const suffix = `${Date.now()}`;
    const companyName = `Custom Connector E2E ${suffix}`;
    try {
      await page.goto("/onboarding");
      const start = page.getByRole("button", { name: /Start Onboarding|New Organization|Add Agent/ });
      if (await start.count()) await start.first().click();
      const create = page.getByRole("button", { name: /Build a new organization/ });
      if (await create.count()) await create.first().click();
      await expect(page.getByRole("heading", { name: "What is the name of your organization?" })).toBeVisible();
      await page.getByPlaceholder("e.g. Northwind Labs").fill(companyName);
      await page.getByRole("button", { name: /^Continue/ }).click();
      await page.locator("#onboarding-agent-name").fill(`Custom Lead ${suffix}`);
      await page.getByRole("button", { name: "Next", exact: true }).click();

      const customSource = page.locator('button[aria-checked]').filter({ hasText: "Custom" });
      await customSource.click();
      await expect(page.getByText("Configure this agent’s model after it is created in Connectors.")).toBeVisible();
      await expect(page.getByLabel("Base URL")).toHaveCount(0);
      await page.waitForTimeout(350);
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.getByRole("button", { name: "Configure model", exact: true }).click();

      const companies = await json<Array<Company>>(await request.get("/api/companies"));
      const company = companies.find((entry) => entry.name === companyName);
      expect(company).toBeTruthy();
      if (!company) throw new Error("Fresh browser-created company was not returned");
      const agentName = `Custom Lead ${suffix}`;
      const agents = await json<Array<Agent & { name: string }>>(
        await request.get(`/api/companies/${company.id}/agents`),
      );
      const agent = agents.find((entry) => entry.name === agentName);
      expect(agent).toBeTruthy();
      if (!agent) throw new Error("Custom first agent was not created");
      // The handoff button has fired; open the company-scoped Runtime surface
      // to continue the real workflow after onboarding dismisses itself.
      await page.goto(`/${company.issuePrefix}/agents/${agent.urlKey ?? agent.id}/runtime`);

      await expect(page.getByRole("button", { name: "Choose a managed connection", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Choose a managed connection", exact: true }).click();
      await page.getByRole("combobox", { name: "Connection" }).click();
      await page.getByRole("option", { name: /Connect an account/ }).click();
      await page.getByRole("button", { name: "Custom endpoint", exact: true }).click();
      await page.getByLabel("Base URL").fill(provider.baseUrl);
      await page.getByLabel("API key", { exact: true }).fill("synthetic-custom-browser-credential");
      await page.getByRole("button", { name: "Connect", exact: true }).last().click();
      await page.getByRole("button", { name: "Use this binding when saved", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const connections = await json<{ connections: Array<{ id: string }> }>(
        await request.get(`/api/companies/${company.id}/ai-connections`),
      );
      expect(connections.connections).toHaveLength(1);
      const connectionId = connections.connections[0]!.id;
      await page.goto(`/${company.issuePrefix}/apps/${connectionId}`);
      await page.getByLabel("Deployment name").fill("fixture-custom-model");
      await page.getByRole("button", { name: "Add deployment", exact: true }).click();
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(page.getByText(/Responses · Verified/)).toBeVisible();

      const verified = await json<Array<{ id: string; status: string }>>(
        await request.get(`/api/companies/${company.id}/ai-connections/${connectionId}/deployments`),
      );
      const deployment = verified.find((entry) => entry.status === "verified");
      expect(deployment).toBeTruthy();
      if (!deployment) throw new Error("Inference verification did not persist a deployment");
      expect(provider.requests).toEqual([
        { method: "GET", path: "/v1/models" },
        { method: "POST", path: "/v1/responses" },
      ]);

      await page.goto(`/${company.issuePrefix}/agents/${agent.urlKey ?? agent.id}/runtime`);
      await page.getByRole("button", { name: "Choose a managed connection", exact: true }).click();
      await page.getByRole("combobox", { name: "Connection" }).click();
      await page.getByRole("option", { name: /My 127\.0\.0\.1/ }).click();
      await page.getByRole("button", { name: "Use this binding when saved", exact: true }).click();
      await expect(page.getByLabel("Verified deployment")).toHaveValue(deployment.id);
      await page.getByRole("button", { name: /Save changes|Save/ }).last().click();

      await page.goto(`/${company.issuePrefix}/issues`);
      await page.getByRole("navigation").getByRole("button", { name: "New Task", exact: true }).click();
      await page.getByRole("dialog").getByRole("textbox", { name: "editable markdown", exact: true }).fill("Use the verified Custom deployment.");
      await expect(page.getByRole("button", { name: "Select assignee", exact: true })).toContainText(agentName);
      await page.getByRole("button", { name: "Create task", exact: true }).click();

      const saved = await json<Agent>(await request.get(`/api/agents/${agent.id}`));
      expect(saved.runtimeConfig.aiConnection).toMatchObject({
        connectionId,
        deploymentId: deployment.id,
      });
    } finally {
      await provider.close();
    }
  });
});
