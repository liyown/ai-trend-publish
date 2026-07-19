import type React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "#lib/utils.ts";

export const buttonVariants = cva(
  "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 text-sm font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]",
        destructive:
          "bg-[var(--danger)] text-white hover:bg-[var(--danger-strong)] focus-visible:ring-[color-mix(in_srgb,var(--danger)_24%,transparent)]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--ink)] hover:bg-[var(--surface-2)]",
        primary: "bg-[var(--ink)] text-white hover:bg-[var(--ink-2)]",
        secondary:
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]",
        ghost: "text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)]",
        danger: "bg-[var(--danger)] text-white hover:bg-[var(--danger-strong)]",
        accent: "bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-strong)]",
        link: "text-[var(--ink)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "min-h-8 px-2.5 text-xs",
        md: "min-h-9 px-3 text-sm",
        lg: "min-h-10 px-4 text-sm",
        icon: "size-9 min-h-0 px-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "children"> & {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button size="icon" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}
