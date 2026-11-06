import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  DiscordChange,
  DiscordMentionPermission,
  DiscordRoleChoice,
  type DiscordRole,
} from "@shared/features/discord";
import { FeatureParticipant, type Feature } from "@shared/features/types";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Selections = Partial<Record<FeatureParticipant, string>>;
export function DiscordPeopleRoles({
  feature,
  disabled,
  refresh,
}: {
  feature: Feature;
  disabled: boolean;
  refresh: () => Promise<unknown>;
}) {
  const t = useT();
  const binding = feature.data.discord!;
  const read = useActionQuery(
    "get-feature-discord-roles",
    { id: feature.id },
    { enabled: false },
  );
  const update = useActionMutation("update-feature-discord");
  const [roles, setRoles] = useState<DiscordRole[]>();
  const [selected, setSelected] = useState<Selections>(() =>
    Object.fromEntries(
      Object.entries(binding.roleMappings ?? {}).map(([key, role]) => [
        key,
        role.id,
      ]),
    ),
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const pending = disabled || read.isFetching || update.isPending;
  const dirty = Object.values(FeatureParticipant).some(
    (key) => selected[key] !== binding.roleMappings?.[key]?.id,
  );
  async function load() {
    setError(undefined);
    try {
      const result = await read.refetch();
      if (result.error) throw result.error;
      setRoles(result.data ?? []);
    } catch (error) {
      setError(actionErrorMessage(error) ?? t("coordinator.error"));
    }
  }
  async function save() {
    setError(undefined);
    setSaved(false);
    try {
      await update.mutateAsync({
        id: feature.id,
        revision: feature.revision,
        change: { event: DiscordChange.ROLES, mappings: selected },
      });
      setSaved(true);
    } catch (error) {
      setError(actionErrorMessage(error) ?? t("coordinator.error"));
    } finally {
      await refresh();
    }
  }
  return (
    <section
      className="space-y-4 border-t border-border pt-4"
      aria-labelledby="people-roles-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="people-roles-heading" className="font-semibold">
          {t("coordinator.discord.peopleTitle")}
        </h3>
        {feature.canApprove && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void load()}
          >
            {read.isFetching
              ? t("coordinator.discord.loadingRoles")
              : t(
                  roles
                    ? "coordinator.discord.reloadRoles"
                    : "coordinator.discord.loadRoles",
                )}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("coordinator.discord.rolesHelp")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(FeatureParticipant).map((responsibility, index) => {
          const id = selected[responsibility];
          const available = roles?.find((role) => role.id === id);
          const stored = binding.roleMappings?.[responsibility];
          return (
            <div key={responsibility} className="min-w-0 space-y-2">
              <Label htmlFor={`discord-role-${index}`}>{responsibility}</Label>
              {roles && feature.canApprove ? (
                <Select
                  value={id ?? DiscordRoleChoice.NONE}
                  disabled={pending}
                  onValueChange={(value) => {
                    setSaved(false);
                    setSelected((current) => {
                      const next = { ...current };
                      if (value === DiscordRoleChoice.NONE)
                        delete next[responsibility];
                      else next[responsibility] = value;
                      return next;
                    });
                  }}
                >
                  <SelectTrigger
                    id={`discord-role-${index}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DiscordRoleChoice.NONE}>
                      {t("coordinator.discord.notMapped")}
                    </SelectItem>
                    {id && !available && (
                      <SelectItem value={id} disabled>
                        {stored?.name ?? id} ·{" "}
                        {t("coordinator.discord.unavailableRole")}
                      </SelectItem>
                    )}
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        @{role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm">
                  {stored
                    ? `@${stored.name}`
                    : t("coordinator.discord.notMapped")}
                </p>
              )}
              {id && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    roles && !available
                      ? "coordinator.discord.missingRole"
                      : available?.mentionPermission ===
                          DiscordMentionPermission.ALLOWED
                        ? "coordinator.discord.mentionAllowed"
                        : available?.mentionPermission ===
                            DiscordMentionPermission.DENIED
                          ? "coordinator.discord.mentionDenied"
                          : "coordinator.discord.mentionUnknown",
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {roles?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("coordinator.discord.noRoles")}
        </p>
      )}
      {roles && feature.canApprove && (
        <Button
          variant="outline"
          disabled={pending || !dirty}
          onClick={() => void save()}
        >
          {update.isPending
            ? t("coordinator.saving")
            : t("coordinator.discord.saveRoles")}
        </Button>
      )}
      {saved && (
        <p role="status" className="text-sm">
          {t("coordinator.discord.rolesSaved")}
        </p>
      )}
    </section>
  );
}
