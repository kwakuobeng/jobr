export type WorkplaceLabel = "Remote" | "Onsite" | "Hybrid" | "Unknown";
export function workplaceBadge(value: unknown): WorkplaceLabel {
  switch (typeof value === "string" ? value.trim().toLowerCase() : "") {
    case "remote": return "Remote";
    case "onsite": return "Onsite";
    case "hybrid": return "Hybrid";
    default: return "Unknown";
  }
}
export function locationLabel(value: unknown): string | null {
  const strings = (item: unknown): string[] => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const parts = [record.city, record.region ?? record.state, record.country].filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
    if (parts.length) return [parts.join(", ")];
    return [record.name ?? record.location ?? record.display_name].filter((part): part is string => typeof part === "string");
  };
  const labels = (Array.isArray(value) ? value : [value]).flatMap(strings)
    .map((part) => part.trim()).filter((part) => part && !/\bunspecified\b/i.test(part));
  return [...new Set(labels)].slice(0, 3).join(" · ") || null;
}
