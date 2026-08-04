import type React from "react";

export function PageGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}
