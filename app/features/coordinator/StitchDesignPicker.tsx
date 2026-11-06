import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function StitchDesignPicker({
  projectId,
  screenId,
  onProject,
  onScreen,
  disabled,
}: {
  projectId: string;
  screenId: string;
  onProject: (id: string) => void;
  onScreen: (id: string) => void;
  disabled: boolean;
}) {
  const t = useT();
  const projects = useActionQuery("get-stitch-designs", {}, { enabled: false });
  const screens = useActionQuery(
    "get-stitch-designs",
    { projectId: projectId || undefined },
    { enabled: !!projectId },
  );
  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || projects.isFetching}
        onClick={() => void projects.refetch()}
      >
        {t(
          projects.isFetching
            ? "coordinator.loadingStitch"
            : "coordinator.loadStitch",
        )}
      </Button>
      {projects.isError && (
        <p role="alert" className="text-sm text-destructive">
          {actionErrorMessage(projects.error) ?? t("coordinator.error")}
        </p>
      )}
      {projects.data?.length === 0 && (
        <p role="status">{t("coordinator.noStitchDesigns")}</p>
      )}
      {!!projects.data?.length && (
        <div className="space-y-2">
          <Label htmlFor="stitch-project">
            {t("coordinator.stitchProject")}
          </Label>
          <Select
            value={projectId}
            onValueChange={(id) => {
              onProject(id);
              onScreen("");
            }}
            disabled={disabled}
          >
            <SelectTrigger id="stitch-project" className="w-full">
              <SelectValue placeholder={t("coordinator.selectProject")} />
            </SelectTrigger>
            <SelectContent>
              {projects.data.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {projectId && (
        <div className="space-y-2">
          <Label htmlFor="stitch-screen">{t("coordinator.stitchScreen")}</Label>
          <Select
            value={screenId}
            onValueChange={onScreen}
            disabled={disabled || screens.isFetching}
          >
            <SelectTrigger id="stitch-screen" className="w-full">
              <SelectValue placeholder={t("coordinator.selectScreen")} />
            </SelectTrigger>
            <SelectContent>
              {screens.data?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {screens.isError && (
        <p role="alert" className="text-sm text-destructive">
          {actionErrorMessage(screens.error) ?? t("coordinator.error")}
        </p>
      )}
    </div>
  );
}
