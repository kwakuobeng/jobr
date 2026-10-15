import { AuthForm } from "@/components/auth/auth-form";
export default async function SignUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm signup next={(await searchParams).next} />;
}
