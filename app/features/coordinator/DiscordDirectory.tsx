import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  DiscordMemberCoverage,
  DiscordMentionPermission,
  DiscordPersonVisibility,
  type DiscordDirectory as Directory,
} from "@shared/features/discord";
import type { Feature } from "@shared/features/types";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DirectoryChoice =
  | { discordRoleId: string }
  | { discordUserId: string };
const MaxShown = 50;

/**
 * Read-only view of the people and roles the bot can verify for the linked
 * channel. With `onSelect` it also lets the owner pick a recipient; Discord
 * membership never implies responsibility or approval authority.
 */
export function DiscordDirectory({
  feature,
  disabled,
  onSelect,
}: {
  feature: Feature;
  disabled?: boolean;
  onSelect?: (choice: DirectoryChoice) => Promise<unknown>;
}) {
  const t = useT();
  const read = useActionQuery(
    "get-feature-discord-directory",
    { id: feature.id },
    { enabled: false },
  );
  const [directory, setDirectory] = useState<Directory>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [userId, setUserId] = useState("");
  const [choosing, setChoosing] = useState(false);
  const pending = disabled || read.isFetching || choosing;
  const channel = `#${feature.data.discord?.channelName ?? ""}`;

  async function load() {
    setError(undefined);
    try {
      const result = await read.refetch();
      if (result.error) throw result.error;
      setDirectory(result.data as Directory);
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  async function choose(choice: DirectoryChoice) {
    if (!onSelect) return;
    setError(undefined);
    setChoosing(true);
    try {
      await onSelect(choice);
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    } finally {
      setChoosing(false);
    }
  }
  const needle = filter.trim().toLowerCase();
  const matches = (directory?.people ?? []).filter(
    (person) =>
      !needle ||
      person.displayName.toLowerCase().includes(needle) ||
      person.username.toLowerCase().includes(needle) ||
      person.roles.some((role) => role.name.toLowerCase().includes(needle)),
  );
  const coverage = directory?.coverage;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("coordinator.directory.help")}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void load()}
        >
          {read.isFetching
            ? t("coordinator.directory.loading")
            : t(
                directory
                  ? "coordinator.directory.reload"
                  : "coordinator.directory.load",
              )}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {coverage && (
        <div role="status" className="space-y-1 text-sm">
          <p>
            {t(`coordinator.directory.members.${coverage.members}` as string, {
              listed: coverage.listed,
              visible: coverage.visible,
              hidden: coverage.hidden,
              unknown: coverage.unknown,
              channel,
            })}
          </p>
          {coverage.limitations.map((limitation) => (
            <p
              key={limitation}
              className="text-xs text-amber-700 dark:text-amber-400"
            >
              {limitation}
            </p>
          ))}
        </div>
      )}
      {directory && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              {t("coordinator.directory.roles")}
            </h4>
            {directory.roles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("coordinator.discord.noRoles")}
              </p>
            )}
            <ul className="space-y-1">
              {directory.roles.map((role) => (
                <li
                  key={role.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    @{role.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t(
                        role.mentionPermission ===
                          DiscordMentionPermission.ALLOWED
                          ? "coordinator.directory.mentionAllowed"
                          : role.mentionPermission ===
                              DiscordMentionPermission.DENIED
                            ? "coordinator.directory.mentionDenied"
                            : "coordinator.directory.mentionUnknown",
                      )}
                    </span>
                  </span>
                  {onSelect && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void choose({ discordRoleId: role.id })}
                    >
                      {t("coordinator.directory.select")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">
              {t("coordinator.directory.people")}
            </h4>
            {directory.people.length > 0 && (
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("coordinator.directory.filter")}
                aria-label={t("coordinator.directory.filter")}
              />
            )}
            {coverage?.members === DiscordMemberCoverage.UNAVAILABLE && (
              <p className="text-xs text-muted-foreground">
                {t("coordinator.directory.none")}
              </p>
            )}
            <ul className="space-y-2">
              {matches.slice(0, MaxShown).map((person) => {
                const visible =
                  person.visibility === DiscordPersonVisibility.VISIBLE;
                return (
                  <li
                    key={person.id}
                    className="flex flex-wrap items-start justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0">
                      <strong>{person.displayName}</strong>{" "}
                      <span className="text-xs text-muted-foreground">
                        @{person.username}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {person.roles.length
                          ? t("coordinator.directory.hasRoles", {
                              roles: person.roles
                                .map((role) => `@${role.name}`)
                                .join(", "),
                            })
                          : t("coordinator.directory.noRolesHeld")}
                      </span>
                      {!visible && (
                        <span className="block text-xs text-amber-700 dark:text-amber-400">
                          {t(
                            person.visibility === DiscordPersonVisibility.HIDDEN
                              ? "coordinator.directory.hidden"
                              : "coordinator.directory.unverified",
                            { channel },
                          )}
                        </span>
                      )}
                    </span>
                    {onSelect && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !visible}
                        onClick={() =>
                          void choose({ discordUserId: person.id })
                        }
                      >
                        {t("coordinator.directory.select")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {matches.length > MaxShown && (
              <p className="text-xs text-muted-foreground">
                {t("coordinator.directory.more", {
                  count: matches.length - MaxShown,
                })}
              </p>
            )}
          </div>
        </>
      )}
      {onSelect && (
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (userId.trim()) void choose({ discordUserId: userId.trim() });
          }}
        >
          <Label htmlFor={`directory-user-${feature.id}`}>
            {t("coordinator.directory.byId")}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`directory-user-${feature.id}`}
              value={userId}
              inputMode="numeric"
              pattern="\d{17,20}"
              onChange={(event) => setUserId(event.target.value)}
              disabled={pending}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={pending || !/^\d{17,20}$/.test(userId.trim())}
            >
              {t("coordinator.directory.verify")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("coordinator.directory.byIdHelp")}
          </p>
        </form>
      )}
    </div>
  );
}
