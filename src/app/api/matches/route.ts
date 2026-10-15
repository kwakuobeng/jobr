import { createClient } from "@/lib/supabase/server";
import { authenticated, errorResponse, findMatches, JobError } from "@/lib/jobs/service";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new JobError("FORBIDDEN", "Same-origin request required.", 403);
    const client = await createClient(); const user = await authenticated(client);
    let input: unknown; try { input = await request.json(); } catch { throw new JobError("INVALID_INPUT", "Invalid JSON request.", 400); }
    return Response.json(await findMatches(client, user.id, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
