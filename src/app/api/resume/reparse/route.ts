import { createClient } from "@/lib/supabase/server";
import { authenticated, errorResponse, JobError } from "@/lib/jobs/service";
import { readBoundedBody, reparseResume } from "@/lib/resume-intake/service";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new JobError("FORBIDDEN", "Same-origin request required.", 403);
    const client = await createClient(); const user = await authenticated(client);
    const body = await readBoundedBody(request, 4096);
    let input: unknown; try { input = JSON.parse(new TextDecoder().decode(body)); } catch { throw new JobError("INVALID_INPUT", "Invalid JSON request.", 400); }
    return Response.json(await reparseResume(client, user.id, input), { headers });
  } catch (error) { return errorResponse(error); }
}
