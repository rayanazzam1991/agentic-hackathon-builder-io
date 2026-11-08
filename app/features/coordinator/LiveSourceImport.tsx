import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DesignProvider, FeatureResource } from "@shared/features/types";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StitchDesignPicker } from "@/features/coordinator/StitchDesignPicker";

export function LiveSourceImport({
  onBusyChange,
  onCancel,
}: {
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const importer = useActionMutation("import-feature-sources");
  const [designProvider, setDesignProvider] = useState<DesignProvider>(
    DesignProvider.STITCH,
  );
  const [projectId, setProjectId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [error, setError] = useState<string>();
  return (
    <div>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError(undefined);
          onBusyChange(true);
          try {
            const result = await importer.mutateAsync({
              jiraUrl: String(form.get("jiraUrl")),
              confluenceUrl: String(form.get("confluenceUrl")),
              designProvider,
              includeFigma: designProvider === DesignProvider.FIGMA,
              ...(designProvider === DesignProvider.FIGMA
                ? { figmaUrl: String(form.get("figmaUrl")) }
                : {}),
              ...(designProvider === DesignProvider.STITCH
                ? { stitchProjectId: projectId, stitchScreenId: screenId }
                : {}),
            });
            navigate(`${FeatureResource.PATH}/${result.id}`);
          } catch (error) {
            setError(actionErrorMessage(error) ?? t("coordinator.error"));
          } finally {
            onBusyChange(false);
          }
        }}
      >
        {(["jiraUrl", "confluenceUrl"] as const).map((name) => (
          <div key={name} className="space-y-2">
            <Label htmlFor={name}>{t(`coordinator.${name}`)}</Label>
            <Input
              id={name}
              name={name}
              type="url"
              placeholder={t(`coordinator.${name}Placeholder`)}
              required
              maxLength={1000}
              disabled={importer.isPending}
            />
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="design-provider">
            {t("coordinator.designProvider")}
          </Label>
          <Select
            value={designProvider}
            onValueChange={(value) =>
              setDesignProvider(value as DesignProvider)
            }
            disabled={importer.isPending}
          >
            <SelectTrigger id="design-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DesignProvider.STITCH}>
                {t("coordinator.stitch")}
              </SelectItem>
              <SelectItem value={DesignProvider.FIGMA}>
                {t("coordinator.figma")}
              </SelectItem>
              <SelectItem value={DesignProvider.NONE}>
                {t("coordinator.noDesign")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {designProvider === DesignProvider.STITCH && (
          <StitchDesignPicker
            projectId={projectId}
            screenId={screenId}
            onProject={setProjectId}
            onScreen={setScreenId}
            disabled={importer.isPending}
          />
        )}
        {designProvider === DesignProvider.FIGMA && (
          <div className="space-y-2">
            <Label htmlFor="figmaUrl">{t("coordinator.figmaUrl")}</Label>
            <Input
              id="figmaUrl"
              name="figmaUrl"
              type="url"
              required
              maxLength={1000}
              disabled={importer.isPending}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={
              importer.isPending ||
              (designProvider === DesignProvider.STITCH &&
                (!projectId || !screenId))
            }
            type="submit"
          >
            {t(
              importer.isPending
                ? "coordinator.importing"
                : "coordinator.importSources",
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={importer.isPending}
            onClick={onCancel}
          >
            {t("coordinator.cancelImport")}
          </Button>
          <a className="text-sm underline" href="/settings/integrations">
            {t("coordinator.connections")}
          </a>
        </div>
      </form>
    </div>
  );
}
