import { ApiErrorSchema } from "../../../specs/api/contracts";
export async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.message : "Request failed. Please try again.");
  }
  return body;
}
export function message(error: unknown) { return error instanceof Error ? error.message : "Request failed. Please try again."; }
