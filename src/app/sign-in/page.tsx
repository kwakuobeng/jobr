import { AuthForm } from "@/components/auth/auth-form";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  return <AuthForm next={params.next} callbackError={Boolean(params.error)} />;
}
