import { useT } from "@agent-native/core/client/i18n";
import { FeatureSource, type Feature } from "@shared/features/types";

import { LOCAL_CODEX_ENABLED } from "@/lib/agent-transport";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function SourceEvidence({ feature }: { feature: Feature }) {
  const t = useT();
  return (
    <section aria-labelledby="source-heading">
      <h2 id="source-heading" className="mb-3 text-sm font-semibold">
        {t("coordinator.sources")}
      </h2>
      {!feature.data.sample &&
        !feature.data.sources.some(
          (s) =>
            s.kind === FeatureSource.FIGMA || s.kind === FeatureSource.STITCH,
        ) && (
          <p
            role="status"
            className="mb-3 rounded-lg border border-border p-3 text-sm"
          >
            {t("coordinator.figmaExcluded")}
          </p>
        )}
      <div className="grid items-start gap-3 xl:grid-cols-3">
        {feature.data.sources.map((source) => (
          <Card key={source.kind} className="gap-3 py-4 shadow-none">
            <CardHeader className="gap-1 px-4">
              <CardTitle className="text-sm capitalize">
                {source.kind}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{source.version}</p>
              {source.url && (
                <a
                  className="text-xs underline"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("coordinator.openSource")}
                </a>
              )}
              {source.capturedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("coordinator.captured")}{" "}
                  {new Date(source.capturedAt).toLocaleString()}
                </p>
              )}
            </CardHeader>
            <CardContent className="min-w-0 px-4 text-sm leading-6">
              {source.screenshot && (
                <figure className="mb-3 space-y-2">
                  <a
                    href={`/api/features/${feature.id}/screenshot`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-border bg-muted"
                  >
                    <img
                      src={`/api/features/${feature.id}/screenshot`}
                      alt={t("coordinator.screenshotAlt", {
                        label: source.screenshot.label,
                      })}
                      className="max-h-80 w-full object-contain"
                      loading="lazy"
                    />
                  </a>
                  <figcaption className="text-xs text-muted-foreground">
                    {t("coordinator.screenshotCaption", {
                      time: new Date(
                        source.screenshot.capturedAt,
                      ).toLocaleString(),
                    })}
                  </figcaption>
                  <p className="text-xs text-muted-foreground">
                    {t("coordinator.screenshotScope")}
                  </p>
                  {LOCAL_CODEX_ENABLED && (
                    <p className="text-xs text-muted-foreground">
                      {t("coordinator.screenshotAgentLimit")}
                    </p>
                  )}
                </figure>
              )}
              {source.kind === FeatureSource.STITCH && !source.screenshot && (
                <p role="status" className="mb-3 text-xs text-muted-foreground">
                  {t("coordinator.screenshotUnavailable")}
                </p>
              )}
              {source.scope && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {source.scope}
                </p>
              )}
              <details>
                <summary className="cursor-pointer font-medium underline underline-offset-4">
                  {t("coordinator.viewCapturedText")}
                </summary>
                <blockquote className="mt-3 whitespace-pre-wrap break-words border-s-2 border-primary/40 ps-3">
                  {source.excerpt}
                </blockquote>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
