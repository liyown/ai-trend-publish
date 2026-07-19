import * as React from "react";

import { cn } from "#lib/utils.ts";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-10 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none transition duration-200 ease-[var(--ease-standard)] selection:bg-[var(--ink)] selection:text-[var(--paper)] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--ink)] placeholder:text-[var(--muted)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] disabled:opacity-70 md:text-sm",
        "focus-visible:border-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        "aria-invalid:border-[var(--danger)] aria-invalid:ring-2 aria-invalid:ring-[color-mix(in_srgb,var(--danger)_18%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
