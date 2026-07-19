import type React from "react";
import {
  Field as BaseField,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#components/ui/field.tsx";
import { cn } from "#lib/utils.ts";

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  helper?: string;
  error?: string;
  className?: string;
}

export function FormField({
  label,
  children,
  htmlFor,
  required,
  helper,
  error,
  className,
}: FormFieldProps) {
  return (
    <BaseField className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={htmlFor} className="flex items-center gap-1">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-[var(--danger)]">
            *
          </span>
        ) : null}
      </FieldLabel>
      {children}
      {helper || error ? (
        <div className="min-h-5" aria-live="polite">
          {error ? (
            <FieldError>{error}</FieldError>
          ) : helper ? (
            <FieldDescription>{helper}</FieldDescription>
          ) : null}
        </div>
      ) : null}
    </BaseField>
  );
}
