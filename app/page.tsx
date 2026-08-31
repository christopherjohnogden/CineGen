import { headers } from "next/headers";
import { CineGenClient } from "./CineGenClient";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type HomeProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Home({ searchParams }: HomeProps) {
  const returnTo = returnPath(await searchParams);
  return <AuthenticatedCineGen returnTo={returnTo} />;
}

async function AuthenticatedCineGen({ returnTo }: { returnTo: string }) {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const requestHost = (forwardedHost ?? requestHeaders.get("host") ?? "")
    .split(",", 1)[0]
    .trim()
    .split(":", 1)[0]
    .toLowerCase();

  // Local development uses CineGen's device-local workspace. Hosted CineGen
  // needs the dispatcher-provided ChatGPT identity before any project or
  // provider request can safely enter the shared team workspace.
  if (requestHost !== "localhost" && requestHost !== "127.0.0.1") {
    await requireChatGPTUser(returnTo);
  }

  return <CineGenClient />;
}

function returnPath(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (typeof value === "string") {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return serialized ? `/?${serialized}` : "/";
}
