export const buildInfo = {
  id: __CHEAPBUGS_BUILD_ID__,
  builtAt: __CHEAPBUGS_BUILD_TIME__
} as const;

export const formatBuildTime = (isoDate: string): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date);
};
