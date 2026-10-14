import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <p className="mb-6 text-sm font-medium tracking-widest text-slate-500">
        YOUR NEXT CHAPTER
      </p>
      <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">Jobr</h1>
      <p className="mt-6 max-w-2xl text-xl leading-relaxed text-slate-600">
        Find opportunities that fit your experience. See the evidence, review
        your matches, and prepare your next move.
      </p>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-500">
        You stay in control. Jobr helps you prepare; you decide whether to apply
        and submit applications yourself.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link href="/matches">Explore matches</Link>
        </Button>
      </div>
    </main>
  );
}
