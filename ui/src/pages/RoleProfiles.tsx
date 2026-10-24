import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, LockKeyhole, Plus, Save, X } from "lucide-react";
import type { AgentRoleProfile } from "@/api/agentRoleProfiles";
import type { AgentRoleProfileManagedFiles } from "@paperclipai/shared";
import { agentRoleProfilesApi } from "@/api/agentRoleProfiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";

type ProfileDraft = {
  name: string;
  description: string;
  changeSummary: string;
  managedFiles: AgentRoleProfileManagedFiles;
};

function profileDraft(profile: AgentRoleProfile): ProfileDraft {
  return {
    name: profile.name,
    description: profile.description ?? "",
    changeSummary: profile.revision.changeSummary ?? "",
    managedFiles: { ...profile.revision.managedFiles },
  };
}

function profileKindLabel(profile: AgentRoleProfile) {
  if (profile.kind === "system_ceo") return "System";
  if (profile.kind === "seeded") return "Seeded";
  return "Custom";
}

export function RoleProfiles() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const profilesQuery = useQuery({
    queryKey: queryKeys.agentRoleProfiles.list(selectedCompanyId ?? ""),
    queryFn: () => agentRoleProfilesApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const profiles = profilesQuery.data ?? [];
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === (selectedProfileId ?? profiles[0]?.id)) ?? null,
    [profiles, selectedProfileId],
  );
  const revisionsQuery = useQuery({
    queryKey: queryKeys.agentRoleProfiles.revisions(selectedCompanyId ?? "", selectedProfile?.id ?? ""),
    queryFn: () => agentRoleProfilesApi.revisions(selectedCompanyId!, selectedProfile!.id),
    enabled: Boolean(selectedCompanyId && selectedProfile),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Role Profiles" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (selectedProfile) setDraft(profileDraft(selectedProfile));
  }, [selectedProfile]);

  const saveProfile = useMutation({
    mutationFn: (payload: ProfileDraft) => agentRoleProfilesApi.update(selectedCompanyId!, selectedProfile!.id, {
      name: payload.name.trim(),
      description: payload.description.trim() || null,
      managedFiles: payload.managedFiles,
      changeSummary: payload.changeSummary.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentRoleProfiles.list(selectedCompanyId ?? "") });
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentRoleProfiles.revisions(selectedCompanyId ?? "", selectedProfile?.id ?? "") });
      pushToast({ title: "Role Profile saved", tone: "success" });
    },
    onError: (error) => pushToast({ title: "Could not save Role Profile", body: error instanceof Error ? error.message : undefined, tone: "error" }),
  });

  if (profilesQuery.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading Role Profiles…</div>;
  if (profilesQuery.isError) return <div className="p-6 text-sm text-destructive">Could not load Role Profiles.</div>;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-80 shrink-0 border-r border-border">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Role Profiles</h1>
          <p className="mt-1 text-sm text-muted-foreground">Initial instruction bundles for new agents.</p>
        </div>
        <div className="p-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setSelectedProfileId(profile.id)}
              className={`w-full rounded-md px-3 py-2 text-left hover:bg-accent ${selectedProfile?.id === profile.id ? "bg-accent" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{profile.name}</span>
                {profile.readOnly ? <LockKeyhole className="size-3 text-muted-foreground" aria-label="Read-only" /> : null}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{profileKindLabel(profile)}</span>
                <span>Revision {profile.revision.number}</span>
                <span>{Object.keys(profile.revision.managedFiles).length} files</span>
              </div>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {selectedProfile ? (
          selectedProfile.readOnly ? (
            <ReadOnlyProfile profile={selectedProfile} />
          ) : draft ? (
            <EditableProfile
              profile={selectedProfile}
              draft={draft}
              revisions={revisionsQuery.data ?? []}
              saving={saveProfile.isPending}
              onChange={setDraft}
              onSave={() => saveProfile.mutate(draft)}
            />
          ) : null
        ) : (
          <p className="text-sm text-muted-foreground">No Role Profiles are available.</p>
        )}
      </main>
    </div>
  );
}

function ReadOnlyProfile({ profile }: { profile: AgentRoleProfile }) {
  return <div className="max-w-3xl space-y-6">
    <div>
      <div className="flex items-center gap-2"><h2 className="text-xl font-bold">{profile.name}</h2><Badge variant="secondary">System</Badge></div>
      <p className="mt-2 text-sm text-muted-foreground">Existing CEO behavior remains unchanged. This profile is an informational representation of the CEO instruction bundle and cannot be edited or applied.</p>
    </div>
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Revision {profile.revision.number}</h3><p className="mt-1 text-sm text-muted-foreground">{profile.revision.changeSummary}</p></div>
      <FileManifest files={profile.revision.managedFiles} readOnly />
    </section>
  </div>;
}

function EditableProfile({ profile, draft, revisions, saving, onChange, onSave }: { profile: AgentRoleProfile; draft: ProfileDraft; revisions: { id: string; number: number; managedFiles: AgentRoleProfileManagedFiles; changeSummary: string | null; createdAt: string | Date | null }[]; saving: boolean; onChange: (draft: ProfileDraft) => void; onSave: () => void }) {
  const setFile = (path: string, content: string) => onChange({ ...draft, managedFiles: { ...draft.managedFiles, [path]: content } });
  const removeFile = (path: string) => {
    const managedFiles = { ...draft.managedFiles };
    delete managedFiles[path];
    onChange({ ...draft, managedFiles });
  };
  const addFile = () => {
    let index = 1;
    let path = "NEW-INSTRUCTIONS.md";
    while (draft.managedFiles[path]) path = `NEW-INSTRUCTIONS-${index++}.md`;
    onChange({ ...draft, managedFiles: { ...draft.managedFiles, [path]: "" } });
  };
  return <div className="max-w-3xl space-y-6">
    <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="text-xl font-bold">{profile.name}</h2><Badge variant="secondary">{profileKindLabel(profile)}</Badge></div><p className="mt-2 text-sm text-muted-foreground">Changes create a new immutable revision. Agents that already adopted this Profile are not changed.</p></div><Button onClick={onSave} disabled={saving || Object.keys(draft.managedFiles).length === 0}><Save />Save revision</Button></div>
    <div className="space-y-4 rounded-lg border border-border p-4">
      <label className="block text-sm font-medium">Name<Input aria-label="Profile name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} className="mt-2" /></label>
      <label className="block text-sm font-medium">Description<Textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} className="mt-2" /></label>
      <label className="block text-sm font-medium">Revision summary<Input value={draft.changeSummary} onChange={(event) => onChange({ ...draft, changeSummary: event.target.value })} className="mt-2" placeholder="Describe this change" /></label>
    </div>
    <section className="rounded-lg border border-border"><div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h3 className="text-sm font-semibold">Managed files</h3><p className="mt-1 text-sm text-muted-foreground">Only these files are copied when this Profile is selected.</p></div><Button variant="outline" size="sm" onClick={addFile}><Plus />Add file</Button></div><div className="space-y-4 p-4">{Object.entries(draft.managedFiles).map(([path, content]) => <div key={path} className="rounded-md border border-border p-3"><div className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><Input aria-label="Managed file path" value={path} onChange={(event) => { const nextPath = event.target.value; const managedFiles = { ...draft.managedFiles }; delete managedFiles[path]; managedFiles[nextPath] = content; onChange({ ...draft, managedFiles }); }} /><Button variant="ghost" size="icon-xs" aria-label={`Remove ${path}`} onClick={() => removeFile(path)}><X /></Button></div><Textarea aria-label={`${path} content`} value={content} onChange={(event) => setFile(path, event.target.value)} className="mt-3 font-mono" /></div>)}</div></section>
    <section><h3 className="text-sm font-semibold">Revision history</h3><div className="mt-2 space-y-2">{(revisions.length ? revisions : [profile.revision]).map((revision) => <div key={revision.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span className="text-sm">Revision {revision.number}</span><span className="text-xs text-muted-foreground">{Object.keys(revision.managedFiles).length} managed files</span></div>)}</div></section>
  </div>;
}

function FileManifest({ files, readOnly }: { files: AgentRoleProfileManagedFiles; readOnly: boolean }) {
  return <div className="divide-y divide-border">{Object.entries(files).map(([path, content]) => <div key={path} className="p-4"><div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-muted-foreground" />{path}</div>{readOnly ? <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">{content}</pre> : null}</div>)}</div>;
}
