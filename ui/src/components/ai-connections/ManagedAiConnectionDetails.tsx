import { heartbeatsApi } from "@/api/heartbeats";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { aiConnectionsApi } from "@/api/ai-connections";
import { toolsApi } from "@/api/tools";
import { useNavigate } from "@/lib/router";
import { AiConnectionAccountControls } from "./AiConnectionAccountControls";
import { AiConnectionUsagePanel } from "./AiConnectionUsagePanel";
import type { ToolConnection, AiConnectionMetadata } from "@paperclipai/shared";
import { aiMethodLabel } from "./model";
import { Input } from "@/components/ui/input";

export function ManagedAiConnectionRow({
  connection,
}: {
  connection: ToolConnection;
}) {
  const metadata = connection.config?.ai as AiConnectionMetadata | undefined;
  if (!metadata) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {metadata.routing ? metadata.routing.kind === "bedrock" ? `Bedrock · ${metadata.routing.region}` : metadata.routing.kind === "openrouter" ? "OpenRouter" : metadata.routing.baseUrl : aiMethodLabel(metadata.provider, metadata.method)} ·{" "}
      {connection.credentialPolicy === "per_user"
        ? "Personal"
        : "Company shared"}
    </p>
  );
}
export function ManagedAiConnectionDetails({
  connection,
}: {
  connection: ToolConnection;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [modelId, setModelId] = useState("");
  const [protocol, setProtocol] = useState<"responses" | "chat">("responses");
  const runs = useQuery({
    queryKey: ["ai-connection-active-runs", connection.id],
    queryFn: () =>
      aiConnectionsApi.activeRuns(connection.companyId, connection.id),
  });
  const accounts = useQuery({
    queryKey: ["ai-connections", connection.companyId],
    queryFn: () => aiConnectionsApi.list(connection.companyId),
  });
  const grants = useQuery({
    queryKey: ["ai-connection-grants", connection.id],
    queryFn: () => toolsApi.listConnectionGrants(connection.id),
  });
  const refresh = () => client.invalidateQueries();
  const makeDefault = useMutation({
    mutationFn: (id: string) =>
      aiConnectionsApi.setDefault(connection.companyId, id),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      toolsApi.revokeConnectionGrant(connection.id, id),
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: (id: string) => heartbeatsApi.cancel(id),
    onSuccess: refresh,
  });
  const account = accounts.data?.connections.find(
    (a) => a.id === connection.id,
  );
  const grant = grants.data?.grants.find((g) => g.id === account?.grantId);
  const grantId = grant?.id;
  const canManageDeployments = Boolean(accounts.data?.canManageConnections || account?.ownerUserId === accounts.data?.currentUserId || account?.createdByUserId === accounts.data?.currentUserId);
  const deployments = useQuery({
    queryKey: ["ai-deployments", connection.companyId, connection.id],
    queryFn: () => aiConnectionsApi.deployments(connection.companyId, connection.id),
    enabled: Boolean(account?.routing && ["gateway", "local"].includes(account.routing.kind) && canManageDeployments),
  });
  const createDeployment = useMutation({
    mutationFn: () => aiConnectionsApi.createDeployment(connection.companyId, connection.id, { modelId, protocol }),
    onSuccess: (deployment) => {
      setModelId("");
      void deployments.refetch();
      void verifyDeployment.mutateAsync(deployment.id);
    },
  });
  const verifyDeployment = useMutation({
    mutationFn: (deploymentId: string) => {
      if (!grantId) throw new Error("Grant unavailable");
      return aiConnectionsApi.verifyDeployment(connection.companyId, connection.id, deploymentId, grantId);
    },
    onSuccess: () => { void deployments.refetch(); void client.invalidateQueries({ queryKey: ["ai-connections", connection.companyId] }); },
  });
  const deleteDeployment = useMutation({
    mutationFn: (deploymentId: string) => aiConnectionsApi.deleteDeployment(connection.companyId, connection.id, deploymentId),
    onSuccess: () => { void deployments.refetch(); void client.invalidateQueries({ queryKey: ["ai-connections", connection.companyId] }); },
  });
  const error =
    accounts.error ??
    grants.error ??
    makeDefault.error ??
    stop.error;
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    );
  if (!account || !grant)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {accounts.isPending || grants.isPending
          ? "Loading AI account…"
          : "This account is not available to you."}
      </p>
    );
  return (
    <div className="space-y-4">
      {account.routing && <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Provider settings</summary><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt className="text-muted-foreground">Destination</dt><dd className="break-all">{account.routing.baseUrl ?? (account.routing.kind === "bedrock" ? account.routing.region : "OpenRouter")}</dd><dt className="text-muted-foreground">API format</dt><dd>{account.routing.kind === "openrouter" ? "Selected by harness" : account.routing.protocol}</dd><dt className="text-muted-foreground">Authentication</dt><dd>{account.routing.auth}</dd></dl></details>}
      {account.routing && ["gateway", "local"].includes(account.routing.kind) && canManageDeployments && <section className="space-y-3 rounded-lg border border-border p-4"><h3 className="text-sm font-medium">Verified deployments</h3><p className="text-xs text-muted-foreground">Agents can use only deployments that pass this stored-credential probe.</p><div className="flex flex-wrap gap-2"><Input aria-label="Deployment model ID" className="max-w-xs" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="Deployment model ID" /><select aria-label="Deployment protocol" className="rounded-md border bg-background px-3 py-2 text-sm" value={protocol} onChange={(event) => setProtocol(event.target.value as "responses" | "chat")}><option value="responses">Responses</option><option value="chat">Chat Completions</option></select><Button type="button" disabled={!modelId.trim() || createDeployment.isPending} onClick={() => createDeployment.mutate()}>Add and verify</Button></div>{(createDeployment.error || verifyDeployment.error || deleteDeployment.error) && <p role="alert" className="text-sm text-destructive">{(createDeployment.error ?? verifyDeployment.error ?? deleteDeployment.error)?.message}</p>}<div className="space-y-2">{deployments.data?.map((deployment) => <div key={deployment.id} className="flex items-center justify-between gap-3 text-sm"><span>{deployment.modelId} · {deployment.protocol} · {deployment.status}</span><span className="flex gap-2">{deployment.status !== "verified" && <Button type="button" size="sm" variant="outline" disabled={verifyDeployment.isPending} onClick={() => verifyDeployment.mutate(deployment.id)}>Verify</Button>}<Button type="button" size="sm" variant="ghost" disabled={deleteDeployment.isPending} onClick={() => deleteDeployment.mutate(deployment.id)}>Remove</Button></span></div>)}{!deployments.isPending && !deployments.data?.length && <p className="text-sm text-muted-foreground">No deployments configured.</p>}</div></section>}
      <AiConnectionAccountControls
        account={account}
        grant={grant}
        currentUserId={accounts.data!.currentUserId}
        onMakeDefault={() => makeDefault.mutate(grant.id)}
        onRevoke={() => revoke.mutateAsync(grant.id).then(() => undefined)}
        revocationDetails={
          <div className="space-y-2">
            {runs.error && (
              <p role="alert">
                Could not load active runs. Retry before revoking.
              </p>
            )}
            {runs.data?.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>
                  {run.agentName} · {run.status}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate(run.id)}
                >
                  Stop run
                </Button>
              </div>
            ))}
          </div>
        }
        onReconnect={() =>
          navigate(
            `/apps/connect?source=${account.provider}&reconnect=${connection.id}&method=ai-${account.method}`,
          )
        }
      />
      <AiConnectionUsagePanel key={`${account.id}:${account.grantId}:${account.status}`} account={account} />
    </div>
  );
}
