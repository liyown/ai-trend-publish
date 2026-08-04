import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "#components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu.tsx";

export type AssociationOption = { id: string; name: string; detail: string };

export function AssociationList({
  items,
  available,
  empty,
  addLabel,
  onAdd,
  onRemove,
  onMove,
}: {
  items: AssociationOption[];
  available: AssociationOption[];
  empty: string;
  addLabel: string;
  onAdd(id: string): void;
  onRemove(id: string): void;
  onMove?(id: string, direction: -1 | 1): void;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)]">
      {items.length ? (
        <div className="divide-y divide-[var(--border)]">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex min-h-14 items-center justify-between gap-5 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <strong className="block text-sm font-semibold text-[var(--ink)]">
                  {item.name}
                </strong>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted-strong)]">
                  {item.detail}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {onMove ? (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 min-h-0"
                      disabled={index === 0}
                      aria-label={`上移${item.name}`}
                      onClick={() => onMove(item.id, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 min-h-0"
                      disabled={index === items.length - 1}
                      aria-label={`下移${item.name}`}
                      onClick={() => onMove(item.id, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 min-h-0"
                  aria-label={`移除${item.name}`}
                  title={`移除${item.name}`}
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-7 text-center text-sm text-[var(--muted)]">{empty}</p>
      )}
      {available.length ? (
        <div className="border-t border-[var(--border)] p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" variant="ghost">
                <Plus className="size-3.5" />
                {addLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              {available.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => onAdd(item.id)}>
                  <span className="min-w-0 py-0.5">
                    <strong className="block truncate text-sm font-medium">{item.name}</strong>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                      {item.detail}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}
