import { cn } from "#lib/utils.ts";

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("grid gap-2 text-sm", className)} {...props} />;
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("grid gap-4", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-xs font-semibold uppercase text-[var(--muted)]", className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs leading-5 text-[var(--muted-strong)]", className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn("text-xs leading-5 text-[var(--danger)]", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
