export function selectCodexExecutable(options: {
  platform: string;
  path: string;
  shimDirectory: string;
  exists?: (path: string) => boolean;
}): { executable: string; source: string } | undefined;
