import type React from "react";
import { cn } from "#lib/utils.ts";

export function Card({
  className,
  children,
  as: Comp = "section",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "section" | "article" | "div";
}) {
  return (
    <Comp
      className={cn(
        "rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--border)_82%,transparent)] bg-[var(--surface)] shadow-[var(--shadow-soft)] transition duration-200 ease-[var(--ease-standard)]",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid gap-1.5 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base font-semibold text-[var(--ink)]", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm leading-6 text-[var(--muted-strong)]", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center gap-2 p-5 pt-0", className)}
      {...props}
    />
  );
}
