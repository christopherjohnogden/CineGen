import { headers } from "next/headers";
import { isAllowedCineGenEmail } from "~/lib/server/common";
import { CineGenClient } from "./CineGenClient";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "./chatgpt-auth";

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

  // Local development uses CineGen's device-local workspace. On the hosted
  // site, signed-out visitors see the public welcome page so link-preview
  // crawlers can read CineGen's metadata without being sent to OpenAI auth.
  if (requestHost !== "localhost" && requestHost !== "127.0.0.1") {
    const user = await getChatGPTUser();
    if (!user) {
      return <ShareLanding signInHref={chatGPTSignInPath(returnTo)} />;
    }
    if (!isAllowedCineGenEmail(user.email)) {
      return <AccessDenied signOutHref={chatGPTSignOutPath("/")} />;
    }
  }

  return <CineGenClient />;
}

function AccessDenied({ signOutHref }: { signOutHref: string }) {
  return (
    <main className="cinegen-welcome cinegen-welcome--denied">
      <section className="cinegen-welcome__content cinegen-access-denied">
        <div className="cinegen-welcome__brand">
          <img src="/cinegen-icon.png" alt="" width="52" height="52" />
          <span>CineGen</span>
        </div>
        <p className="cinegen-welcome__eyebrow">Private team workspace</p>
        <h1>Access restricted.</h1>
        <p className="cinegen-welcome__copy">
          This CineGen studio is available only to its approved team members.
        </p>
        <a className="cinegen-welcome__button cinegen-welcome__button--secondary" href={signOutHref}>
          Use another account
          <span aria-hidden="true">→</span>
        </a>
      </section>
    </main>
  );
}

function ShareLanding({ signInHref }: { signInHref: string }) {
  return (
    <main className="cinegen-welcome">
      <div className="cinegen-welcome__glow" aria-hidden="true" />
      <div className="cinegen-welcome__frame" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <section className="cinegen-welcome__content">
        <div className="cinegen-welcome__brand">
          <img src="/cinegen-icon.png" alt="" width="52" height="52" />
          <span>CineGen</span>
        </div>
        <p className="cinegen-welcome__eyebrow">AI Film Production Studio</p>
        <h1>Create together.</h1>
        <p className="cinegen-welcome__copy">
          A shared creative workspace for turning ideas into cinematic worlds,
          shots, and finished films.
        </p>
        <a className="cinegen-welcome__button" href={signInHref}>
          Open CineGen
          <span aria-hidden="true">→</span>
        </a>
        <p className="cinegen-welcome__note">Private team access · Sign in with ChatGPT</p>
      </section>
      <div className="cinegen-welcome__rail" aria-hidden="true">
        <span>Concept</span>
        <i />
        <span>Generate</span>
        <i />
        <span>Edit</span>
        <i />
        <span>Finish</span>
      </div>
    </main>
  );
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
