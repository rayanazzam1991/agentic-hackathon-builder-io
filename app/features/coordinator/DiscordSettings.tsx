import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DiscordRoleChoice, type DiscordRole } from "@shared/features/discord";
import { FeatureParticipant } from "@shared/features/types";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DiscordSettings() {
  const t = useT();
  const setup = useActionQuery("get-discord-setup", {});
  const rolesQuery = useActionQuery(
    "get-discord-setup-roles",
    {},
    { enabled: false },
  );
  const connect = useActionMutation("connect-discord-setup");
  const save = useActionMutation("save-discord-setup-roles");
  const reset = useActionMutation("reset-discord-setup");
  const [confirmReset, setConfirmReset] = useState(false);
  const [roles, setRoles] = useState<DiscordRole[]>();
  const [selected, setSelected] = useState<
    Partial<Record<FeatureParticipant, string>>
  >({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const busy =
    connect.isPending ||
    save.isPending ||
    reset.isPending ||
    rolesQuery.isFetching;
  async function resetSetup() {
    setError(undefined);
    setNotice(undefined);
    try {
      await reset.mutateAsync({});
      setRoles(undefined);
      setSelected({});
      await setup.refetch();
      setConfirmReset(false);
      setNotice(t("coordinator.discordSettings.resetSuccess"));
    } catch (e) {
      setConfirmReset(false);
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
      await setup.refetch();
    }
  }
  async function connectChannel(url: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      await connect.mutateAsync({ channelUrl: url });
      setRoles(undefined);
      await setup.refetch();
      setNotice(t("coordinator.discordSettings.connected"));
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  async function loadRoles() {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await rolesQuery.refetch();
      if (result.error) throw result.error;
      setRoles(result.data ?? []);
      setSelected(
        Object.fromEntries(
          Object.entries(setup.data?.roleMappings ?? {}).map(([key, role]) => [
            key,
            role.id,
          ]),
        ),
      );
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  async function saveRoles() {
    setError(undefined);
    setNotice(undefined);
    try {
      await save.mutateAsync({ mappings: selected });
      await setup.refetch();
      setNotice(t("coordinator.discordSettings.saved"));
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  return (
    <section className="space-y-5" aria-labelledby="discord-settings-title">
      <h2 id="discord-settings-title" className="text-lg font-semibold">
        {t("coordinator.discordSettings.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("coordinator.discordSettings.help")}{" "}
        <a className="underline" href="/settings/api-keys">
          {t("coordinator.discord.keys")}
        </a>
      </p>
      {setup.isPending && <p role="status">{t("coordinator.loading")}</p>}
      {setup.isError && (
        <p role="alert">
          {t("coordinator.error")}{" "}
          <Button variant="outline" onClick={() => void setup.refetch()}>
            {t("coordinator.retry")}
          </Button>
        </p>
      )}
      {setup.data && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {t("coordinator.discordSettings.current")}: #
            {setup.data.channelName}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            {t("coordinator.discordSettings.reset")}
          </Button>
        </div>
      )}
      <Dialog
        open={confirmReset}
        onOpenChange={(open) => {
          if (!reset.isPending) setConfirmReset(open);
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (reset.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (reset.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("coordinator.discordSettings.resetTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("coordinator.discordSettings.resetHelp")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={reset.isPending}
              onClick={() => setConfirmReset(false)}
            >
              {t("coordinator.cancelImport")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={reset.isPending}
              onClick={() => void resetSetup()}
            >
              {reset.isPending
                ? t("coordinator.discordSettings.resetting")
                : t("coordinator.discordSettings.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connectChannel(
            String(new FormData(event.currentTarget).get("channelUrl")),
          );
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="settings-discord-channel">
            {t("coordinator.discord.channel")}
          </Label>
          <Input
            id="settings-discord-channel"
            name="channelUrl"
            type="url"
            placeholder="https://discord.com/channels/…/…"
            required
            disabled={busy}
          />
        </div>
        <Button
          type="submit"
          disabled={busy || setup.isPending || setup.isError}
        >
          {connect.isPending
            ? t("coordinator.saving")
            : t("coordinator.discord.connect")}
        </Button>
      </form>
      {setup.data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">
              {t("coordinator.discord.peopleTitle")}
            </h3>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void loadRoles()}
            >
              {rolesQuery.isFetching
                ? t("coordinator.discord.loadingRoles")
                : t("coordinator.discord.loadRoles")}
            </Button>
          </div>
          {roles && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.values(FeatureParticipant).map(
                  (responsibility, index) => (
                    <div key={responsibility} className="space-y-2">
                      <Label htmlFor={`default-role-${index}`}>
                        {responsibility}
                      </Label>
                      <Select
                        value={
                          selected[responsibility] ?? DiscordRoleChoice.NONE
                        }
                        onValueChange={(value) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (value === DiscordRoleChoice.NONE)
                              delete next[responsibility];
                            else next[responsibility] = value;
                            return next;
                          })
                        }
                        disabled={busy}
                      >
                        <SelectTrigger id={`default-role-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DiscordRoleChoice.NONE}>
                            {t("coordinator.discord.notMapped")}
                          </SelectItem>
                          {selected[responsibility] &&
                            !roles.some(
                              (role) => role.id === selected[responsibility],
                            ) && (
                              <SelectItem
                                value={selected[responsibility]!}
                                disabled
                              >
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
                    </div>
                  ),
                )}
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void saveRoles()}
              >
                {save.isPending
                  ? t("coordinator.saving")
                  : t("coordinator.discord.saveRoles")}
              </Button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
