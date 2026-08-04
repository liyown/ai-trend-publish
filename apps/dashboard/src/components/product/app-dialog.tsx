import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#components/ui/dialog.tsx";
import { cn } from "#lib/utils.ts";

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: "default" | "medium" | "wide";
  children: ReactNode;
}

const AppDialogFooterRootContext = createContext<HTMLElement | null>(null);

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "default",
  children,
}: AppDialogProps) {
  const [footerRoot, setFooterRoot] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "grid max-h-[min(800px,calc(100dvh-24px))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[var(--radius)] border-[var(--border)] bg-[var(--surface)] p-0 shadow-[0_4px_12px_rgba(20,20,24,0.16)]",
          size === "wide"
            ? "sm:max-w-[min(1080px,calc(100vw-32px))]"
            : size === "medium"
              ? "sm:max-w-[min(800px,calc(100vw-32px))]"
              : "sm:max-w-xl",
        )}
      >
        <AppDialogFooterRootContext.Provider value={footerRoot}>
          <DialogHeader className="grid min-w-0 gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 pr-14 text-left">
            <DialogTitle className="min-w-0 break-words text-base font-semibold leading-6 text-[var(--ink)]">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="min-w-0 break-words text-xs leading-5 text-[var(--muted-strong)]">
                {description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div
            data-slot="app-dialog-content"
            className="scrollbar-stable min-h-0 overflow-y-auto overscroll-contain bg-[var(--surface)] p-5"
          >
            {children}
          </div>
          <div data-slot="app-dialog-footer-root" ref={setFooterRoot} />
        </AppDialogFooterRootContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

export function AppDialogFooter({ className, ...props }: ComponentProps<"div">) {
  const footerRoot = useContext(AppDialogFooterRootContext);
  if (!footerRoot) return null;

  return createPortal(
    <div
      data-slot="app-dialog-footer"
      className={cn(
        "border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3 [&_button]:min-h-8 [&_button]:px-2.5 [&_button]:text-xs",
        className,
      )}
      {...props}
    />,
    footerRoot,
  );
}
