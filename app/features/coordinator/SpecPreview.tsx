import { useT } from "@agent-native/core/client/i18n";
import { FeatureSource, type Feature } from "@shared/features/types";
export function SpecPreview({ feature }: { feature: Feature }) {
  const t = useT();
  if (!feature.data.question.proposal) return null;
  return (
    <section
      className="rounded-xl border border-border p-5"
      aria-labelledby="preview-heading"
    >
      <h2 id="preview-heading" className="font-semibold">
        {t("coordinator.preview")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("coordinator.unpublished")}
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            {t("coordinator.before")}
          </h3>
          <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6">
            {
              feature.data.sources.find(
                (s) => s.kind === FeatureSource.CONFLUENCE,
              )?.excerpt
            }
          </p>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            {t("coordinator.after")}
          </h3>
          <p className="whitespace-pre-wrap rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm leading-6">
            {feature.data.question.proposal}
          </p>
        </div>
      </div>
    </section>
  );
}
