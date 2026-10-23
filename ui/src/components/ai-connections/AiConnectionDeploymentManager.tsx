import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AiDeploymentSummary } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AiConnectionDeploymentManager({
  companyId,
  connectionId,
  grantId,
  deployments,
  canManage,
  isLoading = false,
  error,
  onRefresh,
  onRetry,
}: {
  companyId: string;
  connectionId: string;
  grantId?: string;
  deployments: AiDeploymentSummary[];
  canManage: boolean;
  isLoading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  onRetry?: () => void;
}) {
  const [deploymentName, setDeploymentName] = useState("");
  const [protocol, setProtocol] = useState<"responses" | "chat">("responses");

  const createDeployment = useMutation({
    mutationFn: () => aiConnectionsApi.createDeployment(companyId, connectionId, { modelId: deploymentName.trim(), protocol }),
    onSuccess: () => {
      setDeploymentName("");
      onRefresh?.();
    },
  });
  const verifyDeployment = useMutation({
    mutationFn: (deploymentId: string) => {
      if (!grantId) throw new Error("Grant unavailable");
      return aiConnectionsApi.verifyDeployment(companyId, connectionId, deploymentId, grantId);
    },
    onSuccess: () => onRefresh?.(),
  });
  const deleteDeployment = useMutation({
    mutationFn: (deploymentId: string) => aiConnectionsApi.deleteDeployment(companyId, connectionId, deploymentId),
    onSuccess: () => onRefresh?.(),
  });

  const visibleDeployments = canManage ? deployments : deployments.filter((deployment) => deployment.status === "verified");
  const busy = createDeployment.isPending || verifyDeployment.isPending || deleteDeployment.isPending;
  const issue = error ?? createDeployment.error ?? verifyDeployment.error ?? deleteDeployment.error;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Verified deployments</h3>
        <p className="text-xs text-muted-foreground">
          {canManage
            ? "Enter the deployment name shown in Azure Portal. Azure OpenAI model catalogs do not identify this resource’s deployments."
            : "Only verified deployments are shown here."}
        </p>
      </div>

      {canManage && (
        <div className="space-y-3">
          <div className="space-y-3">
            <Input
              aria-label="Deployment name"
              value={deploymentName}
              onChange={(event) => setDeploymentName(event.target.value)}
              placeholder="Azure Portal deployment name"
            />
            <Select value={protocol} onValueChange={(value) => setProtocol(value as "responses" | "chat")}>
              <SelectTrigger aria-label="Deployment protocol" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="responses">Responses</SelectItem>
                <SelectItem value="chat">Chat Completions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={busy || !deploymentName.trim()} onClick={() => createDeployment.mutate()}>
            Add deployment
          </Button>
        </div>
      )}

      {issue ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{issue.message}</span>
          {onRetry && (
            <Button type="button" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : null}

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading deployments…</p>
      ) : visibleDeployments.length ? (
        <div className="space-y-2">
          {visibleDeployments.map((deployment) => (
            <div key={deployment.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium">{deployment.displayName ?? deployment.modelId}</p>
                <p className="text-xs text-muted-foreground">
                  {deployment.protocol === "responses" ? "Responses" : "Chat Completions"} · {deployment.status === "verified" ? "Verified" : deployment.status === "stale" ? "Stale" : "Failed"}
                </p>
                {deployment.status !== "verified" && deployment.lastError ? (
                  <p className="break-words text-xs text-destructive">{deployment.lastError}</p>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => verifyDeployment.mutate(deployment.id)}>
                    {deployment.status === "verified" ? "Reverify" : "Verify"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => deleteDeployment.mutate(deployment.id)}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {canManage ? "No deployments configured yet." : "No verified deployments yet."}
        </p>
      )}
    </section>
  );
}
