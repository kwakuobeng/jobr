import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function MatchesPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/"
        className="text-sm font-semibold text-slate-600 underline underline-offset-4"
      >
        Jobr home
      </Link>
      <h1 className="mt-10 text-3xl font-bold tracking-tight">Your matches</h1>
      <p className="mt-3 text-slate-600">
        Opportunities grounded in your experience and preferences.
      </p>
      <section
        aria-labelledby="empty-heading"
        className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-16 text-center"
      >
        <h2 id="empty-heading" className="text-xl font-semibold">
          Your next opportunity starts here
        </h2>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-slate-600">
          No matches yet. Your matched opportunities will appear here once your
          profile is ready.
        </p>
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href="/">Back to Jobr</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
