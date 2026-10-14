export interface DateIntervalInput {
  id: string;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  isInternship: boolean;
}
export interface MergedExperienceResult {
  totalProfessionalMonths: number;
  totalInternshipMonths: number;
  mergedIntervals: Array<{
    startMonthIndex: number;
    endMonthIndex: number;
    durationMonths: number;
  }>;
}
export function toMonthIndex(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`Invalid ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(`Invalid ISO date: ${value}`);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}
// Calendar months are inclusive, consistent with the supplied reference and existing tests.
// Inject referenceIsoDate for reproducibility; production calls use the current UTC date.
export function calculateNonOverlappingExperience(
  intervals: DateIntervalInput[],
  referenceIsoDate = new Date().toISOString().slice(0, 10),
): MergedExperienceResult {
  const reference = toMonthIndex(referenceIsoDate);
  const merge = (internship: boolean) => {
    const normalized = intervals
      .filter((i) => i.isInternship === internship)
      .map((i) => {
        const startMonthIndex = toMonthIndex(i.startDate);
        const endMonthIndex =
          i.isCurrent || i.endDate === null
            ? reference
            : toMonthIndex(i.endDate);
        if (
          startMonthIndex > endMonthIndex ||
          (!i.isCurrent && i.endDate !== null && i.startDate > i.endDate)
        )
          throw new Error(`Reversed experience interval: ${i.id}`);
        if (endMonthIndex > reference)
          throw new Error(`Future experience interval: ${i.id}`);
        return {
          startMonthIndex,
          endMonthIndex,
          durationMonths: endMonthIndex - startMonthIndex + 1,
        };
      })
      .sort(
        (a, b) =>
          a.startMonthIndex - b.startMonthIndex ||
          a.endMonthIndex - b.endMonthIndex,
      );
    const merged: MergedExperienceResult["mergedIntervals"] = [];
    for (const interval of normalized) {
      const last = merged[merged.length - 1];
      if (!last || interval.startMonthIndex > last.endMonthIndex)
        merged.push({ ...interval });
      else {
        last.endMonthIndex = Math.max(
          last.endMonthIndex,
          interval.endMonthIndex,
        );
        last.durationMonths = last.endMonthIndex - last.startMonthIndex + 1;
      }
    }
    return merged;
  };
  const professional = merge(false),
    internships = merge(true);
  return {
    totalProfessionalMonths: professional.reduce(
      (n, i) => n + i.durationMonths,
      0,
    ),
    totalInternshipMonths: internships.reduce(
      (n, i) => n + i.durationMonths,
      0,
    ),
    mergedIntervals: professional,
  };
}
