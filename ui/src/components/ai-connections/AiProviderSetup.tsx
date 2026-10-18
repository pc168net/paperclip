import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Monitor } from "lucide-react";
import {
  aiProviderRoutingSchema,
  createAiConnectionSchema,
  type AiProvider,
  type AiProviderRouting,
  type AiConnectionBinding,
  type AiManagedConnectionSummary,
} from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { agentsApi } from "@/api/agents";
import { ConnectionChoiceList } from "@/features/connections/ConnectionChoiceList";
import { ConnectionAccessDefaults, connectionDefaultSummarySentence } from "@/features/connections/ConnectionSetupFlow";
import { AppLogo } from "@/pages/apps/AppLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AiConnectionCredentialStep } from "./AiConnectionCredentialStep";
import type { CustomEndpointDraft } from "../new-agent/AgentBasicsDialog";

const providers = [
  {
    id: "openai",
    name: "OpenAI",
    description: "ChatGPT subscription or API key",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude subscription or API key",
  },
  { id: "google", name: "Google", description: "Gemini API key" },
  { id: "xai", name: "xAI", description: "Grok subscription or API key" },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Models through one API key",
    advanced: true,
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    description: "Bedrock API key and AWS region",
    advanced: true,
  },
  {
    id: "gateway",
    name: "Custom endpoint",
    description: "Azure, LiteLLM, or another compatible endpoint",
    advanced: true,
  },
  {
    id: "local",
    name: "Local endpoint",
    description: "A model server in the agent’s environment",
    advanced: true,
  },
] as const;
type ProviderChoice = (typeof providers)[number]["id"];

export function AiProviderSetup({
  companyId,
  agentId,
  environmentId,
  initialProvider,
  initialProtocol,
  customEndpointDraft,
  providerLabel,
  advancedOnly = false,
  reconnect,
  onCancel,
  onComplete,
}: {
  companyId: string;
  agentId?: string;
  environmentId?: string;
  initialProvider?: ProviderChoice;
  initialProtocol?: AiProviderRouting["protocol"];
  customEndpointDraft?: CustomEndpointDraft;
  providerLabel?: string;
  advancedOnly?: boolean;
  reconnect?: AiManagedConnectionSummary;
  onCancel: () => void;
  onComplete: (
    binding: Exclude<AiConnectionBinding, { mode: "responsible_user" }>,
  ) => void;
}) {
  const [provider, setProvider] = useState<ProviderChoice | undefined>(
    reconnect
      ? reconnect.routing?.kind === "gateway" ||
        reconnect.routing?.kind === "local" ||
        reconnect.routing?.kind === "bedrock"
        ? reconnect.routing.kind
        : reconnect.provider
      : initialProvider,
  );
  const [step, setStep] = useState(
    reconnect || initialProvider ? "connect" : "provider",
  );
  const [editingExisting, setEditingExisting] = useState(false);
  const [ownershipChoice, setOwnership] = useState<"personal" | "shared">();
  const [allAgentsChoice, setAllAgents] = useState<boolean>();
  const [agentIds, setAgentIds] = useState(new Set(agentId ? [agentId] : []));
  const [protocol, setProtocol] = useState<AiProviderRouting["protocol"]>(
    customEndpointDraft?.protocol ?? reconnect?.routing?.protocol ?? initialProtocol ?? "responses",
  );
  const [auth, setAuth] = useState<AiProviderRouting["auth"]>(
    customEndpointDraft?.auth ?? reconnect?.routing?.auth ?? "bearer",
  );
  const [baseUrl, setBaseUrl] = useState(customEndpointDraft?.baseUrl ?? reconnect?.routing?.baseUrl ?? "");
  const [region, setRegion] = useState(
    reconnect?.routing?.region ?? "us-east-1",
  );
  const [models, setModels] = useState(
    customEndpointDraft?.models.join(", ") ?? reconnect?.routing?.models.map((m) => m.id).join(", ") ?? "",
  );
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; label?: string }>>([]);
  const [discoveryProtocols, setDiscoveryProtocols] = useState<{ responses: boolean; chat: boolean }>();
  const [apiKey, setApiKey] = useState(customEndpointDraft?.apiKey ?? "");
  // A draft only seeds the shared form. It must remain editable: hiding the
  // fields made a stale model/protocol from the previous adapter step look
  // authoritative and could disable Connect when discovery did not advertise
  // OPTIONS support.
  const isDraftedGateway = false;
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["ai-connections", companyId, agentId],
    queryFn: () => aiConnectionsApi.list(companyId, agentId),
  });
  const canManageConnections = accounts.data?.canManageConnections ?? false;
  const ownership = reconnect?.ownership ?? ownershipChoice ?? (!agentId && canManageConnections ? "shared" : "personal");
  const allAgents = allAgentsChoice ?? (!agentId && canManageConnections);
  const agents = useQuery({
    queryKey: ["agents", companyId, "provider-access"],
    queryFn: () => agentsApi.list(companyId),
  });
  const label = providerLabel ?? providers.find((p) => p.id === provider)?.name ?? "provider";
  const advanced = reconnect ? Boolean(reconnect.routing) : ["openrouter", "bedrock", "gateway", "local"].includes(provider ?? "");
  const nativeProvider: AiProvider =
    provider === "bedrock"
      ? "anthropic"
      : provider === "gateway" || provider === "local"
        ? protocol === "messages"
          ? "anthropic"
          : "openai"
        : (provider ?? "openai");
  const name =
    reconnect?.name ??
    `${ownership === "personal" ? "My" : "Company"} ${
      provider === "gateway" && baseUrl
        ? (() => {
            try {
              return new URL(baseUrl).hostname;
            } catch {
              return label;
            }
          })()
        : label
    }`;
  const complete = (result: {
    connectionId: string;
    grantId: string;
    method?: "api_key" | "subscription";
  }) => {
    void client.invalidateQueries({ queryKey: ["ai-connections", companyId] });
    void client.invalidateQueries({ queryKey: ["tools"] });
    onComplete({
      provider: nativeProvider,
      method: result.method ?? "api_key",
      mode: ownership === "shared" ? "shared" : "delegated",
      ...result,
    });
  };
  const discover = useMutation({
    mutationFn: () => aiConnectionsApi.discoverCustom(companyId, {
      baseUrl,
      auth,
      ...(auth !== "none" ? { apiKey } : {}),
    }),
    onSuccess: (result) => {
      setDiscoveredModels(result.models);
      // A connection owns the endpoint and credential; keep the complete
      // provider model catalog so each agent can choose its own model later.
      setModels(result.models.map((model) => model.id).join(", "));
      setDiscoveryProtocols(result.protocols);
       if (result.protocols.responses && !result.protocols.chat) setProtocol("responses");
       if (result.protocols.chat && !result.protocols.responses) setProtocol("chat");
       if (!result.protocols.responses && !result.protocols.chat) setProtocol("responses");
    },
  });
  useEffect(() => {
    if (!customEndpointDraft || provider !== "gateway" || !baseUrl.trim() || (auth !== "none" && !apiKey.trim())) return;
    discover.mutate();
    // This is a one-time handoff from the New Agent adapter step. The shared
    // form owns discovery from here onward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customEndpointDraft]);
  const save = useMutation({
    mutationFn: () => {
      const routing = reconnect && !editingExisting
        ? reconnect.routing
        : aiProviderRoutingSchema.parse({
          kind: provider,
          protocol: provider === "bedrock" ? "bedrock" : protocol,
          auth: provider === "openrouter" ? "bearer" : auth,
          ...(provider === "bedrock"
            ? { region }
            : provider === "gateway" || provider === "local"
              ? { baseUrl }
              : {}),
          models: models
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
            .map((id) => ({ id })),
        });
      return aiConnectionsApi.create(
        companyId,
        createAiConnectionSchema.parse({
          provider: nativeProvider,
          method: "api_key",
          name,
          ownership,
          allAgents,
          agentIds: [...agentIds],
          connectionId: reconnect?.id,
          routing,
          ...(auth !== "none" ? { apiKey } : {}),
        }),
      );
    },
    onSuccess: complete,
  });
  const revoke = useMutation({
    mutationFn: () => aiConnectionsApi.revoke(companyId, reconnect!.id, reconnect!.grantId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ai-connections", companyId] });
      onCancel();
    },
  });
  const choices = (advancedOnly: boolean) => (
    <ConnectionChoiceList
      choices={providers
        .filter((p) => Boolean("advanced" in p && p.advanced) === advancedOnly)
        .map((p) => ({
          ...p,
          icon:
            p.id === "gateway" || p.id === "local" ? (
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                {p.id === "gateway" ? (
                  <Network className="size-5" />
                ) : (
                  <Monitor className="size-5" />
                )}
              </span>
            ) : (
              <AppLogo name={p.name} brandKey={p.id} />
            ),
        }))}
      onSelect={(id) => {
        setProvider(id as ProviderChoice);
        setStep("connect");
        setApiKey("");
        setAuth("bearer");
        save.reset();
      }}
    />
  );
  const modelSettings = (
    <label className="block space-y-2 text-xs text-muted-foreground">
      Model IDs (comma separated)
      <Input
        aria-label="Model IDs"
        value={models}
        onChange={(e) => setModels(e.target.value)}
        disabled={Boolean(reconnect)}
      />
      <span className="block">
        Use the provider’s model ID or your gateway’s alias. You can
        also enter one on the agent.
      </span>
    </label>
  );
  const accessDefaults = !reconnect ? (
    <ConnectionAccessDefaults
      companyId={companyId}
      extra={advanced ? modelSettings : undefined}
      agents={agents.data ?? []}
      sentence={connectionDefaultSummarySentence({ grantKind: ownership === "shared" ? "organization" : "user", authKind: auth === "none" ? "none" : "api_key", installChoice: allAgents ? "all" : "specific", installCount: agentIds.size })}
      capabilities={{ canCreateOrganizationGrant: canManageConnections, canSetCompanyInstall: canManageConnections }}
      authKind={auth === "none" ? "none" : "api_key"}
      grantKind={ownership === "shared" ? "organization" : "user"}
      grantKinds={["user", "organization"]}
      setGrantKind={kind => setOwnership(kind === "organization" ? "shared" : "personal")}
      installChoice={allAgents ? "all" : "specific"}
      setInstallChoice={choice => setAllAgents(choice === "all")}
      installAgentIds={agentIds}
      setInstallAgentIds={setAgentIds}
      disabled={save.isPending}
      notice={!canManageConnections ? ["Only a connection manager can share this credential with everyone or give every agent access."] : undefined}
    />
  ) : undefined;
  const cancel = () => reconnect || initialProvider ? onCancel() : setStep("provider");
  if (!reconnect && accounts.isPending) return <p role="status">Loading connection permissions…</p>;
  if (!reconnect && accounts.isError) return <p role="alert">Could not load connection permissions. <Button type="button" variant="ghost" onClick={() => void accounts.refetch()}>Retry</Button></p>;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6" onSubmit={(event) => event.stopPropagation()}>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          {step === "provider"
            ? "Connect a model provider"
            : `${reconnect ? "Reconnect" : "Connect"} ${label}`}
        </h2>
      </div>
      {agents.isError && <p role="alert" className="text-sm text-destructive">Could not load agents. <Button type="button" variant="ghost" onClick={() => void agents.refetch()}>Retry</Button></p>}
      {step === "provider" ? (
        <>
          {advancedOnly ? choices(true) : <>
          {choices(false)}
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Advanced providers
            </summary>
            <div className="pt-4">{choices(true)}</div>
          </details>
          </>}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : !advanced ? (
        <AiConnectionCredentialStep
          companyId={companyId}
          provider={nativeProvider}
          connectionId={reconnect?.id}
          initialMethod={reconnect?.method}
          fixedMethod={Boolean(reconnect)}
          name={name}
          hideName
          ownership={ownership}
          allAgents={allAgents}
          agentIds={[...agentIds]}
          environmentId={environmentId}
          onCancel={cancel}
          defaults={accessDefaults}
          disabled={!reconnect && ownership === "shared" && !allAgents && agentIds.size === 0}
          onComplete={complete}
        />
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {reconnect && !editingExisting && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingExisting(true)}>Edit connection</Button>
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
                {revoke.isPending ? "Revoking…" : "Revoke connection"}
              </Button>
            </div>
          )}
          {(provider === "gateway" || provider === "local") && (
            <>
              {isDraftedGateway ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p>Custom endpoint configuration carried from the previous step.</p>
                  <p className="break-all"><span className="font-medium text-foreground">Base URL:</span> {baseUrl}</p>
                  <p><span className="font-medium text-foreground">API format:</span> {protocol === "responses" ? "OpenAI Responses · Codex" : "Chat Completions · OpenCode"}</p>
                </div>
              ) : (
                <>
                  <label className="block space-y-2 text-xs text-muted-foreground">
                    Base URL
                    <Input
                      aria-label="Base URL"
                      placeholder={provider === "local" ? "http://localhost:11434/v1" : "https://gateway.example.com/v1"}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                       disabled={Boolean(reconnect && !editingExisting)}
                    />
                    {provider === "gateway" && (
                      <Button type="button" variant="outline" onClick={() => discover.mutate()} disabled={discover.isPending || !baseUrl.trim() || (auth !== "none" && !apiKey.trim())}>
                        {discover.isPending ? "Fetching models…" : "Fetch models"}
                      </Button>
                    )}
                  </label>
                  <label className="block space-y-2 text-xs text-muted-foreground">
                    API format
                    <Select
                      value={protocol}
                      onValueChange={(v) => {
                        setProtocol(v as typeof protocol);
                        if (v !== "messages" && provider !== "gateway" && auth === "api_key") setAuth("bearer");
                      }}
                       disabled={Boolean(reconnect && !editingExisting) || Boolean(initialProtocol)}
                    >
                      <SelectTrigger aria-label="API format" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="responses">OpenAI Responses · Custom</SelectItem>
                        <SelectItem value="messages">Anthropic Messages · Claude</SelectItem>
                        <SelectItem value="chat">Chat Completions · Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </>
              )}
            </>
          )}
          {provider === "bedrock" && (
            <label className="block space-y-2 text-xs text-muted-foreground">
              AWS region
              <Input
                aria-label="AWS region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                 disabled={Boolean(reconnect && !editingExisting)}
              />
            </label>
          )}
          {provider !== "openrouter" && !isDraftedGateway && (
            <label className="block space-y-2 text-xs text-muted-foreground">
              Authentication
              <Select
                value={auth}
                onValueChange={(v) => setAuth(v as typeof auth)}
                 disabled={Boolean(reconnect && !editingExisting)}
              >
                <SelectTrigger aria-label="Authentication" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">
                    {provider === "bedrock"
                      ? "Bedrock API key"
                      : "Bearer token"}
                  </SelectItem>
                  {provider !== "bedrock" && (
                    <>
                      {(protocol === "messages" || provider === "gateway") && (
                        <SelectItem value="api_key">
                          {provider === "gateway" && protocol !== "messages"
                            ? "API key · api-key"
                            : "API key · x-api-key"}
                        </SelectItem>
                      )}
                      <SelectItem value="none">No authentication</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </label>
          )}
          {
            auth !== "none" && !isDraftedGateway && (
              <label className="block space-y-2 text-xs text-muted-foreground">
                API key
                <Input
                  aria-label="API key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
            )
          }
          {provider === "gateway" && (isDraftedGateway || discoveredModels.length > 0) && (
            <label className="block space-y-2 text-xs text-muted-foreground">
              Model / deployment
              {isDraftedGateway ? (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">{models}</p>
              ) : <>
                 <select aria-label="Model / deployment" className="block w-full rounded-md border bg-background px-3 py-2 text-sm" value={models.split(",")[0]?.trim() ?? ""} onChange={(event) => setModels([event.target.value, ...models.split(",").map((id) => id.trim()).filter((id) => id && id !== event.target.value)].join(", "))}>
                  {discoveredModels.map((model) => <option key={model.id} value={model.id}>{model.label ?? model.id}</option>)}
                </select>
                <Input aria-label="Model / deployment fallback" value={models} onChange={(event) => setModels(event.target.value)} placeholder="Enter a deployment or model ID" />
              </>}
            </label>
          )}
          {provider === "gateway" && discoveryProtocols && !isDraftedGateway && (
            <div className="space-y-1 text-xs text-muted-foreground" role="status">
              {discoveryProtocols.responses && discoveryProtocols.chat
                ? "Both API formats are supported. Using OpenAI Responses by default."
                : discoveryProtocols.responses
                   ? "Detected: OpenAI Responses · Custom runner"
                  : discoveryProtocols.chat
                     ? "Detected: Chat Completions · Custom runner"
                    : "This endpoint does not advertise Responses or Chat Completions support."}
              {discoveryProtocols.responses && discoveryProtocols.chat && <span className="block">Change format above to override the default.</span>}
            </div>
          )}
          {reconnect && <details><summary className="cursor-pointer text-sm text-muted-foreground">Model settings</summary>{modelSettings}</details>}
          <p className="text-xs text-muted-foreground">
            Paperclip tests this endpoint with <code>/models</code> before saving.
            Agent execution compatibility is checked separately when the connection is used.
          </p>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error instanceof Error && save.error.name === "ZodError"
                ? "Check the URL, API format, and authentication fields."
                : save.error.message}
            </p>
          )}
          {accessDefaults}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={save.isPending}
            >
              Back
            </Button>
            <Button
              type="submit"
              disabled={
                save.isPending || accounts.isPending || accounts.isError ||
                (!reconnect && ownership === "shared" && !allAgents && agentIds.size === 0) ||
                (auth !== "none" && !apiKey.trim()) ||
                 (provider === "gateway" && !models.trim())
              }
            >
              {save.isPending
                ? "Connecting…"
                : reconnect
                  ? (editingExisting ? "Save changes" : "Reconnect")
                  : "Connect"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
