"use client";

import * as React from "react";
import { Check, Trash2 } from "lucide-react";
import type { CategoryDto } from "@/lib/products";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/misc";
import { ConfirmButton } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage, plural } from "@/components/orders/format";

/** Dialog to add, rename, reorder and delete categories. `children` is the trigger button. */
export function CategoryManager({ categories, onChanged, children }: { categories: CategoryDto[]; onChanged: () => Promise<void>; children: React.ReactNode }) {
  const [name, setName] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    try {
      await apiFetch("/api/categories", { method: "POST", json: { name: trimmed } });
      setName("");
      toast.success(`Added “${trimmed}”`);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Categories" description="Customers see products grouped in this order. Lower numbers show first.">
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-category">New category</Label>
            <Input
              id="new-category"
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Drinks"
              maxLength={60}
              aria-invalid={!!error}
              aria-describedby={error ? "new-category-error" : undefined}
            />
          </div>
          <Button type="submit" className="h-11" disabled={adding || !name.trim()}>
            {adding && <Spinner />}
            Add
          </Button>
        </form>
        {error && (
          <p id="new-category-error" role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {categories.length === 0 ? (
          <p className="mt-6 rounded-lg bg-muted p-4 text-sm text-muted-foreground">No categories yet. Add one above, or import a CSV with a category column.</p>
        ) : (
          <ul className="mt-6 divide-y rounded-lg border">
            {categories.map((c) => (
              <CategoryRow key={`${c.id}:${c.name}:${c.sortOrder}`} category={c} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({ category, onChanged }: { category: CategoryDto; onChanged: () => Promise<void> }) {
  const [name, setName] = React.useState(category.name);
  const [order, setOrder] = React.useState(String(category.sortOrder));
  const [saving, setSaving] = React.useState(false);
  const orderNumber = Number(order);
  const dirty = name.trim() !== category.name || orderNumber !== category.sortOrder;
  const valid = name.trim().length > 0 && order.trim() !== "" && Number.isInteger(orderNumber);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || !valid) return;
    setSaving(true);
    try {
      await apiFetch("/api/categories", { method: "PATCH", json: { id: category.id, name: name.trim(), sortOrder: orderNumber } });
      toast.success("Category saved");
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save the category"));
      setSaving(false);
    }
  }

  return (
    <li className="p-3">
      <form onSubmit={save} className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input aria-label="Category name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11" />
          <p className="mt-1 text-xs text-muted-foreground">{plural(category.productCount, "product")}</p>
        </div>
        <Input
          aria-label={`Display order for ${category.name}`}
          title="Display order (lower shows first)"
          inputMode="numeric"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="h-11 w-16 self-start text-center"
        />
        <div className="flex self-start">
          {dirty && (
            <Button type="submit" size="icon" variant="outline" className="size-11" disabled={!valid || saving} aria-label={`Save ${category.name}`}>
              {saving ? <Spinner /> : <Check aria-hidden />}
            </Button>
          )}
          <ConfirmButton
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 text-destructive hover:text-destructive"
            aria-label={`Delete ${category.name}`}
            title={`Delete “${category.name}”?`}
            description={
              category.productCount
                ? `Its ${plural(category.productCount, "product")} will stay on your menu, without a category.`
                : "No products use this category."
            }
            confirmLabel="Delete category"
            destructive
            onConfirm={async () => {
              await apiFetch(`/api/categories?id=${encodeURIComponent(category.id)}`, { method: "DELETE" });
              toast.success(`Deleted “${category.name}”`);
              await onChanged();
            }}
          >
            <Trash2 aria-hidden />
          </ConfirmButton>
        </div>
      </form>
    </li>
  );
}
