import type { Metadata } from "next";
import { SignIn } from "./SignIn";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <SignIn next={next ?? "/passes"} />;
}
