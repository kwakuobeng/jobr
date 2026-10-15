export type WorkplaceLabel = "Remote" | "Onsite" | "Hybrid" | "Unknown";

export type WorkplaceBadge = {
  label: WorkplaceLabel;
  inferred: boolean;
};

export type WorkplaceContext = {
  title?: string | null;
  locations_json?: unknown;
  description?: string | null;
};

function explicitLabel(value: unknown): WorkplaceLabel {
  switch (typeof value === "string" ? value.trim().toLowerCase() : "") {
    case "remote":
      return "Remote";
    case "onsite":
      return "Onsite";
    case "hybrid":
      return "Hybrid";
    default:
      return "Unknown";
  }
}

/** Flatten already-stored location payloads into searchable text fragments. */
export function locationTextParts(value: unknown): string[] {
  const parts: string[] = [];
  const visit = (item: unknown, depth = 0): void => {
    if (depth > 4 || item == null) return;
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) parts.push(trimmed);
      return;
    }
    if (typeof item === "boolean" || typeof item === "number") return;
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry, depth + 1);
      return;
    }
    if (typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    for (const key of [
      "city",
      "region",
      "state",
      "country",
      "name",
      "location",
      "display_name",
      "LocationName",
      "PositionLocationDisplay",
      "workplace",
      "workplaceType",
      "workplace_type",
      "telework",
      "TeleworkEligible",
      "teleworkEligible",
      "RemoteIndicator",
      "remoteIndicator",
    ]) {
      const field = record[key];
      if (typeof field === "string" && field.trim()) parts.push(field.trim());
      // Boolean remote/telework flags from stored feed data: only `true` is a positive signal.
      else if (field === true && /telework|remote/i.test(key)) parts.push("remote-eligible");
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visit(value, depth + 1);
    }
  };
  visit(value);
  return parts;
}

function inferFromCorpus(corpus: string): WorkplaceLabel | null {
  if (!corpus.trim()) return null;
  const hybrid = /\bhybrid\b/i.test(corpus);
  const remote = /\bremote\b|work from home|telework|anywhere/i.test(corpus);
  const onsite = /\bonsite\b|\bon-site\b|\bin-office\b|\bin office\b/i.test(corpus);
  // Hybrid wins when remote cues appear alongside it.
  if (hybrid) return "Hybrid";
  if (onsite) return "Onsite";
  if (remote) return "Remote";
  return null;
}

/**
 * Map a stored workplace enum to a display badge. When the enum is unspecified/null,
 * soft-infer from already-returned title / locations / description text only (display-only).
 */
export function workplaceBadge(value: unknown, context?: WorkplaceContext): WorkplaceBadge {
  const explicit = explicitLabel(value);
  if (explicit !== "Unknown") return { label: explicit, inferred: false };

  const corpus = [
    typeof context?.title === "string" ? context.title : "",
    typeof context?.description === "string" ? context.description : "",
    ...locationTextParts(context?.locations_json),
  ].join("\n");
  const inferred = inferFromCorpus(corpus);
  if (inferred) return { label: inferred, inferred: true };
  return { label: "Unknown", inferred: false };
}

export function locationLabel(value: unknown): string | null {
  const strings = (item: unknown): string[] => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const parts = [record.city, record.region ?? record.state, record.country].filter(
      (part): part is string => typeof part === "string" && Boolean(part.trim()),
    );
    if (parts.length) return [parts.join(", ")];
    return [record.name ?? record.location ?? record.display_name].filter(
      (part): part is string => typeof part === "string",
    );
  };
  const labels = (Array.isArray(value) ? value : [value])
    .flatMap(strings)
    .map((part) => part.trim())
    .filter((part) => part && !/\bunspecified\b/i.test(part));
  return [...new Set(labels)].slice(0, 3).join(" · ") || null;
}
