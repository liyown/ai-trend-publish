import * as React from "react";

import { cn } from "#lib/utils.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b [&_tr]:border-[color-mix(in_srgb,var(--border)_72%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-[color-mix(in_srgb,var(--border)_58%,transparent)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-2)_58%,transparent)] has-aria-expanded:bg-[var(--surface-2)] data-[state=selected]:bg-[var(--surface-2)]",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-semibold whitespace-nowrap text-[var(--muted-strong)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, children, ref, ...props }: React.ComponentProps<"td">) {
  const cellRef = React.useRef<HTMLTableCellElement | null>(null);
  const [overflowText, setOverflowText] = React.useState<string | null>(null);
  const composedRef = React.useCallback(
    (node: HTMLTableCellElement | null) => {
      cellRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;

    const measure = () => {
      const candidates = Array.from(
        cell.querySelectorAll<HTMLElement>('.truncate, [class*="line-clamp-"]'),
      );
      const overflowing = candidates.find(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      );
      const text = overflowing?.textContent?.trim() || null;
      setOverflowText((current) => (current === text ? current : text));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    for (const candidate of cell.querySelectorAll<HTMLElement>(
      '.truncate, [class*="line-clamp-"]',
    )) {
      observer.observe(candidate);
    }
    return () => observer.disconnect();
  });

  return (
    <Tooltip open={overflowText ? undefined : false}>
      <TooltipTrigger asChild>
        <td
          ref={composedRef}
          data-slot="table-cell"
          className={cn(
            "p-2 align-middle whitespace-nowrap text-[var(--ink)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
            className,
          )}
          {...props}
        >
          {children}
        </td>
      </TooltipTrigger>
      {overflowText ? (
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-[360px] whitespace-normal text-pretty leading-5 motion-reduce:animate-none"
        >
          {overflowText}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
