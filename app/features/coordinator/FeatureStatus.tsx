import { useT } from "@agent-native/core/client/i18n";
import { QuestionStatus } from "@shared/features/types";
import { IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
export function FeatureStatus({ status }: { status: QuestionStatus }) {
  const t = useT();
  const Icon =
    status === QuestionStatus.APPROVED ? IconCircleCheck : IconCircleDashed;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium">
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`coordinator.status.${status}`)}
    </span>
  );
}
