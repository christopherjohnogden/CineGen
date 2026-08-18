"use client";

import dynamic from "next/dynamic";

const CineGenRuntime = dynamic(() => import("./CineGenRuntime"), {
  ssr: false,
  loading: () => <div className="cinegen-site-loading">Loading CineGen</div>,
});

export function CineGenClient() {
  return <CineGenRuntime />;
}
