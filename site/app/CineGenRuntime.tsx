"use client";

import "../../web/src/platform/install";
import { ErrorBoundary } from "../../src/components/error-boundary";
import { WebApp } from "../../web/src/WebApp";

export default function CineGenRuntime() {
  return (
    <ErrorBoundary>
      <WebApp />
    </ErrorBoundary>
  );
}
