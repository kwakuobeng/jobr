import { createClient } from "@/lib/supabase/server";
import { authenticated, errorResponse, JobError } from "@/lib/jobs/service";
import { currentResume, editResume, readBoundedBody, readResumeFile, uploadResume } from "@/lib/resume-intake/service";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new JobError("FORBIDDEN", "Same-origin request required.", 403);
}
export async function GET() {
  try { const client = await createClient(); const user = await authenticated(client); return Response.json(await currentResume(client, user.id), { headers }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request); const client = await createClient(); const user = await authenticated(client);
    const file = await readResumeFile(request);
    return Response.json(await uploadResume(client, user.id, file), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request); const client = await createClient(); const user = await authenticated(client);
    const body = await readBoundedBody(request, 32768);
    let input: unknown; try { input = JSON.parse(new TextDecoder().decode(body)); } catch { throw new JobError("INVALID_INPUT", "Invalid JSON request.", 400); }
    return Response.json(await editResume(client, user.id, input), { headers });
  } catch (error) { return errorResponse(error); }
}
