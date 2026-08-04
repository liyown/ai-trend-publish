import * as React from "react";

import { cn } from "#lib/utils.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none transition duration-200 ease-[var(--ease-standard)] placeholder:text-[var(--muted)] focus-visible:border-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] disabled:opacity-70 aria-invalid:border-[var(--danger)] aria-invalid:ring-2 aria-invalid:ring-[color-mix(in_srgb,var(--danger)_18%,transparent)] md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
