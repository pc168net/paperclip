import { useId } from "react";
import { Plus, UserRound } from "lucide-react";
import {
  aiConnectionCatalogSlug,
  isAiConnectionCompatible,
  type AiConnectionBinding,
  type AiDeploymentSummary,
} from "@paperclipai/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLogo } from "@/pages/apps/AppLogo";
import { Button } from "@/components/ui/button";
import { aiConnectionProblem, personalAiDefault } from "./model";
import type { AiConnectionPickerProps } from "./AiConnectionPicker";
import type { AiConnectionSummary } from "./model";

function ConnectionLabel({ connection, label }: { connection: AiConnectionSummary; label?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AppLogo name={connection.name} brandKey={aiConnectionCatalogSlug(connection.provider, connection.routing)} size={20} compact />
      <span className="truncate">{label ?? connection.name}</span>
    </span>
  );
}

/** The same connection control on Create agent and Harness / Runtime. */
export function AiConnectionSelect({
  requirement,
  connections,
  value,
  currentUserId,
  readOnly,
  loading,
  error,
  onRetry,
  onConnect,
  onReconnect,
  onChange,
  adapterType,
  onManageConnection,
  connectedOnly = false,
}: AiConnectionPickerProps & {
  adapterType: string;
  onManageConnection?: (connection: AiConnectionSummary) => void;
  /** Agent creation chooses a previously verified account; setup lives in Connectors. */
  connectedOnly?: boolean;
}) {
  const selectId = useId();
  const personal = connectedOnly ? undefined : personalAiDefault(connections, requirement, currentUserId);
  /** Routed endpoints are represented by their verified deployment, not their
   * provider catalog. Plain provider accounts retain their existing choice. */
  const choices: Array<{ id: string; connection: AiConnectionSummary; deployment?: AiDeploymentSummary }> = connections.flatMap((connection) => {
    const requiresDeployment = connection.routing && ["gateway", "local"].includes(connection.routing.kind);
    if (!requiresDeployment) return connectedOnly ? [] : [{ id: connection.id, connection }];
    return (connection.deployments ?? [])
      .filter((deployment) => deployment.status === "verified")
      .map((deployment) => ({ id: deployment.id, connection, deployment }));
  });
  const selected =
    connectedOnly && value?.mode === "responsible_user"
      ? undefined
      : value?.mode === "responsible_user"
      ? personal
      : connections.find(
          (c) => c.id === value?.connectionId && c.grantId === value?.grantId,
        );
  const selectedChoice = value?.mode !== "responsible_user"
    ? choices.find((choice) => choice.connection.id === value?.connectionId && choice.connection.grantId === value?.grantId &&
      (!value.deploymentId || choice.deployment?.id === value.deploymentId))
    : undefined;
  const selectedDeploymentId = value && value.mode !== "responsible_user" ? value.deploymentId : undefined;
  const compatible = choices
    .filter(
      ({ connection: c }) =>
        c.companyId === requirement.companyId &&
        (connectedOnly ? c.status === "connected" : c.status !== "revoked") &&
        isAiConnectionCompatible(
          c,
          adapterType,
          c.provider === "openrouter" ? "openrouter/" : undefined,
        ),
    )
    .sort(
      (a, b) =>
        Number(a.id === selectedChoice?.id) - Number(b.id === selectedChoice?.id) ||
        Number(Boolean(a.connection.routing)) - Number(Boolean(b.connection.routing)) ||
        a.connection.name.localeCompare(b.connection.name),
    );
  const unavailable = Boolean(
    value &&
      value.mode !== "responsible_user" &&
      !selectedChoice &&
      !loading &&
      !error,
  );
  const canUseDefault = isAiConnectionCompatible(
    {
      provider: requirement.provider,
      method: "api_key",
      mode: "responsible_user",
    },
    adapterType,
    requirement.provider === "openrouter" ? "openrouter/" : undefined,
  );
  const incompatible =
    selected && !compatible.some((choice) => choice.id === selectedChoice?.id);
  const change = (id: string) => {
    if (connectedOnly && (id === "connect" || id === "responsible_user")) return;
    if (id === "connect") return onConnect();
    if (id === "responsible_user")
      return onChange({
        provider: requirement.provider,
        method: personal?.method ?? "api_key",
        mode: "responsible_user",
      });
    const choice = compatible.find((candidate) => candidate.id === id);
    if (!choice) return;
    const { connection, deployment } = choice;
    if (aiConnectionProblem(connection)) {
      onManageConnection?.(connection);
      return;
    }
    onChange({
      provider: connection.provider,
      method: connection.method,
      mode: connection.ownership === "shared" ? "shared" : "delegated",
      connectionId: connection.id,
      grantId: connection.grantId,
      ...(deployment ? { deploymentId: deployment.id } : {}),
    } satisfies AiConnectionBinding);
  };
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground" htmlFor={selectId}>
        Connection
      </label>
      <Select
        value={
          value?.mode === "responsible_user"
            ? "responsible_user"
            : (selectedDeploymentId ?? value?.connectionId ?? "")
        }
        onValueChange={change}
        disabled={readOnly || loading || Boolean(error)}
      >
        <SelectTrigger id={selectId} aria-label="Connection" className="w-full">
          <SelectValue
            placeholder={
              loading ? "Loading connections…" : "Choose a connection"
            }
          >
            {selected
              ? <ConnectionLabel connection={selected} label={value?.mode === "responsible_user" ? "Responsible user’s default" : selectedChoice?.deployment ? `${selected.name} · ${selectedChoice.deployment.modelId}` : undefined} />
              : value?.mode === "responsible_user"
                ? "Responsible user’s default"
                : value ? "Unavailable connection" : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {incompatible && selected && (
            <SelectItem value={selectedDeploymentId ?? selected.id} disabled>
              <ConnectionLabel connection={selected} label={`${selected.name} · Incompatible`} />
            </SelectItem>
          )}
          {compatible.map(({ id, connection, deployment }) => (
            <SelectItem
              key={id}
              value={id}
            >
              <ConnectionLabel connection={connection} label={`${connection.name}${deployment ? ` · ${deployment.modelId}` : ""}${connection.status !== "connected" ? " · Reconnect" : ""}`} />
            </SelectItem>
          ))}
          {!connectedOnly && (canUseDefault || value?.mode === "responsible_user") && (
            <SelectItem value="responsible_user" disabled={!canUseDefault}>
              <span className="flex size-5 shrink-0 items-center justify-center"><UserRound className="size-4" /></span>
              Responsible user’s default
            </SelectItem>
          )}
          {!connectedOnly && <SelectItem value="connect">
              <span className="flex size-5 shrink-0 items-center justify-center"><Plus className="size-4" /></span>
              Connect an account…
            </SelectItem>}
        </SelectContent>
      </Select>
      {!connectedOnly && !readOnly && onManageConnection && connections.filter(c => c.status !== "revoked" && aiConnectionProblem(c)).map(connection => (
        <Button key={connection.id} type="button" variant="outline" onClick={() => onManageConnection(connection)}>
          Manage {connection.name}
        </Button>
      ))}
      {!connectedOnly && !readOnly && onReconnect && !loading && !error && (
        <Button type="button" variant="outline" onClick={onReconnect}>Reconnect account</Button>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Retry connections
          </Button>
        </div>
      )}
      {!connectedOnly && value?.mode === "responsible_user" && !personal && !loading && !error ? (
        <p role="alert" className="text-sm text-destructive">
          {connectedOnly
            ? "No verified connection is available for this provider. Add or reconnect it in Connectors."
            : "You have no default account for this provider. Connect an account or choose another connection."}
        </p>
      ) : unavailable ? (
        <p role="alert" className="text-sm text-destructive">
          This connection is unavailable. Choose another connection.
        </p>
      ) : incompatible ? (
        <p role="alert" className="text-sm text-destructive">
          This connection does not support the selected harness. Choose a
          compatible connection.
        </p>
      ) : selected && aiConnectionProblem(selected) ? (
        <p role="alert" className="text-sm text-destructive">
          {aiConnectionProblem(selected)}
        </p>
      ) : connectedOnly && compatible.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          No verified deployment is available. Add or verify one in Connectors first.
        </p>
      ) : null}
    </div>
  );
}
