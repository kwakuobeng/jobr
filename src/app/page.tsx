export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Jobr</h1>
      <p className="mt-2 text-slate-600">M1.1 foundation scaffold.</p>
      <a href="/matches" className="mt-4 mr-5 inline-block underline focus-visible:outline">Open matches</a>
      <a href="/sign-in" className="mt-4 inline-block underline focus-visible:outline">Sign in</a>
    </main>
  );
}
