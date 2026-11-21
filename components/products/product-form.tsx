"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { CategoryDto, ProductDto } from "@/lib/products";
import { MAX_PRODUCT_IMAGES } from "@/lib/products-csv";
import { apiFetch } from "@/lib/fetcher";
import { parseToKobo } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label, Switch } from "@/components/ui/misc";
import { ConfirmButton } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/components/orders/format";
import { ImageManager, type ImageItem } from "./image-manager";
import { uploadImage } from "./upload";

type ProductResponse = { product: ProductDto; canEdit: boolean; currency: string };

type FormState = { name: string; description: string; price: string; categoryId: string; available: boolean; sortOrder: string };

const EMPTY: FormState = { name: "", description: "", price: "", categoryId: "", available: true, sortOrder: "" };

function koboToInput(kobo: number): string {
  return kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2);
}

function toForm(p: ProductDto): FormState {
  return {
    name: p.name,
    description: p.description,
    price: koboToInput(p.priceKobo),
    categoryId: p.categoryId ?? "",
    available: p.available,
    sortOrder: String(p.sortOrder),
  };
}

/** Create (no productId) or edit a product. Staff get a read-only view. */
export function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter();
  const isNew = !productId;

  const [product, setProduct] = React.useState<ProductDto | null>(null);
  const [canEdit, setCanEdit] = React.useState(isNew);
  const [currency, setCurrency] = React.useState<string | null>(null);
  const [categories, setCategories] = React.useState<CategoryDto[]>([]);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [pendingImages, setPendingImages] = React.useState<{ storageKey: string; url: string }[]>([]);

  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [dirty, setDirty] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cats, res] = await Promise.all([
        apiFetch<{ categories: CategoryDto[] }>("/api/categories"),
        productId ? apiFetch<ProductResponse>(`/api/products/${productId}`) : Promise.resolve(null),
      ]);
      setCategories(cats.categories);
      if (res) {
        setProduct(res.product);
        setCanEdit(res.canEdit);
        setCurrency(res.currency);
        setForm(toForm(res.product));
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setDirty(true);
  }

  function validate(): { priceKobo: number; sortOrder: number | undefined } | null {
    const errs: typeof fieldErrors = {};
    if (!form.name.trim()) errs.name = "Enter a product name";
    const priceKobo = parseToKobo(form.price);
    if (priceKobo === null || priceKobo <= 0) errs.price = "Enter a price like 1500 or 1500.50";
    const sortOrder = form.sortOrder.trim() === "" ? undefined : Number(form.sortOrder);
    if (sortOrder !== undefined && !Number.isInteger(sortOrder)) errs.sortOrder = "Use a whole number";
    setFieldErrors(errs);
    return Object.keys(errs).length || priceKobo === null ? null : { priceKobo, sortOrder };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = validate();
    if (!valid) return;
    setSaving(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      priceKobo: valid.priceKobo,
      categoryId: form.categoryId || null,
      available: form.available,
      ...(valid.sortOrder !== undefined ? { sortOrder: valid.sortOrder } : {}),
    };
    try {
      if (isNew) {
        await apiFetch("/api/products", { method: "POST", json: { ...body, imageKeys: pendingImages.map((i) => i.storageKey) } });
        toast.success(`${body.name} added to your menu`);
        router.push("/dashboard/products");
        return;
      }
      const res = await apiFetch<{ product: ProductDto }>(`/api/products/${productId}`, { method: "PATCH", json: body });
      setProduct(res.product);
      setForm(toForm(res.product));
      setDirty(false);
      toast.success("Changes saved");
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err, "Couldn't save the product"));
    } finally {
      setSaving(false);
    }
  }

  // Image actions: saved products change on the server immediately; new products hold keys until create.
  const imageItems: ImageItem[] = isNew
    ? pendingImages.map((i) => ({ id: i.storageKey, url: i.url }))
    : (product?.images ?? []).map((i) => ({ id: i.id, url: i.url }));

  async function onUpload(file: File) {
    const { storageKey, publicUrl } = await uploadImage(file);
    if (isNew) {
      setPendingImages((list) => [...list, { storageKey, url: publicUrl }]);
      return;
    }
    const res = await apiFetch<{ product: ProductDto }>(`/api/products/${productId}/images`, { method: "POST", json: { storageKey } });
    setProduct(res.product);
  }

  async function onDeleteImage(id: string) {
    if (isNew) {
      setPendingImages((list) => list.filter((i) => i.storageKey !== id));
      return;
    }
    const res = await apiFetch<{ product: ProductDto }>(`/api/products/${productId}/images/${id}`, { method: "DELETE" });
    setProduct(res.product);
  }

  async function onMakeCover(id: string) {
    if (isNew) {
      setPendingImages((list) => [...list.filter((i) => i.storageKey === id), ...list.filter((i) => i.storageKey !== id)]);
      return;
    }
    const ids = imageItems.map((i) => i.id);
    const imageIds = [id, ...ids.filter((x) => x !== id)];
    const res = await apiFetch<{ product: ProductDto }>(`/api/products/${productId}/images`, { method: "PATCH", json: { imageIds } });
    setProduct(res.product);
  }

  const back = { href: "/dashboard/products", label: "Products" };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true" aria-label="Loading product">
        <PageHeader className="mb-0" title={isNew ? "Add product" : "Product"} back={back} />
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader className="mb-0" title={isNew ? "Add product" : "Product"} back={back} />
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const title = isNew ? "Add product" : (product?.name ?? "Product");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        className="mb-0"
        title={title}
        back={back}
        actions={
          !isNew &&
          canEdit && (
            <ConfirmButton
              variant="outline"
              className="h-11 text-destructive hover:text-destructive"
              title={`Delete “${product?.name ?? ""}”?`}
              description="The bot stops offering it straight away. Past orders keep their details."
              confirmLabel="Delete product"
              destructive
              onConfirm={async () => {
                await apiFetch(`/api/products/${productId}`, { method: "DELETE" });
                toast.success(`${product?.name ?? "Product"} deleted`);
                router.push("/dashboard/products");
              }}
            >
              <Trash2 aria-hidden /> Delete
            </ConfirmButton>
          )
        }
      />
      {!canEdit && <p className="rounded-lg bg-muted p-3 text-sm">Only the business owner can edit products.</p>}

      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset disabled={!canEdit || saving} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
              <CardDescription>The bot uses the name, price and description to answer customers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="name" label="Name" error={fieldErrors.name}>
                <Input
                  id="name"
                  className="h-11"
                  placeholder="e.g. Jollof rice with chicken"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  maxLength={120}
                  required
                  aria-invalid={!!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? "name-error" : undefined}
                />
              </Field>
              <Field id="price" label="Price" error={fieldErrors.price} hint="e.g. 1500 or 1500.50">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                    {currency ?? "NGN"}
                  </span>
                  <Input
                    id="price"
                    className="h-11 pl-14 tabular-nums"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                    required
                    aria-invalid={!!fieldErrors.price}
                    aria-describedby={fieldErrors.price ? "price-error" : "price-hint"}
                  />
                </div>
              </Field>
              <Field id="description" label="Description" optional hint="Ingredients, portion size, spice level. Helps the bot answer questions.">
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  maxLength={1000}
                  rows={3}
                  aria-describedby="description-hint"
                />
              </Field>
              <CategoryPicker
                categories={categories}
                value={form.categoryId}
                onChange={(id) => set("categoryId", id)}
                onCreated={(c) => {
                  setCategories((list) => [...list, c]);
                  set("categoryId", c.id);
                }}
                canEdit={canEdit}
              />
              <Field id="sortOrder" label="Display order" optional error={fieldErrors.sortOrder} hint="Lower numbers show first in their category">
                <Input
                  id="sortOrder"
                  className="h-11 sm:w-40"
                  inputMode="numeric"
                  value={form.sortOrder}
                  onChange={(e) => set("sortOrder", e.target.value)}
                  aria-invalid={!!fieldErrors.sortOrder}
                  aria-describedby={fieldErrors.sortOrder ? "sortOrder-error" : "sortOrder-hint"}
                />
              </Field>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="available">Available to order</Label>
                  <p id="available-hint" className="text-xs text-muted-foreground">
                    When off, the bot won&apos;t offer or sell this product.
                  </p>
                </div>
                <Switch id="available" aria-describedby="available-hint" checked={form.available} onCheckedChange={(v) => set("available", v)} />
              </div>
            </CardContent>
          </Card>
        </fieldset>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photos</CardTitle>
            <CardDescription>{isNew ? "Photos are saved with the product." : "Photo changes are saved straight away."}</CardDescription>
          </CardHeader>
          <CardContent>
            <ImageManager
              items={imageItems}
              max={MAX_PRODUCT_IMAGES}
              disabled={!canEdit || saving}
              onUpload={onUpload}
              onDelete={onDeleteImage}
              onMakeCover={onMakeCover}
            />
          </CardContent>
        </Card>

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
            {error && (
              <p role="alert" className="text-sm text-destructive sm:mr-auto">
                {error}
              </p>
            )}
            {!error && !isNew && dirty && <p className="text-xs text-muted-foreground sm:mr-auto">You have unsaved changes.</p>}
            <Button type="submit" size="lg" className="h-12 w-full sm:h-11 sm:w-auto" disabled={saving || (!isNew && !dirty)}>
              {saving && <Spinner />}
              {saving ? "Saving…" : isNew ? "Create product" : "Save changes"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function CategoryPicker({
  categories,
  value,
  onChange,
  onCreated,
  canEdit,
}: {
  categories: CategoryDto[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (c: CategoryDto) => void;
  canEdit: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A nested <form> is invalid HTML, so the quick-add uses a button + Enter handler instead.
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ category: CategoryDto }>("/api/categories", { method: "POST", json: { name: name.trim() } });
      onCreated(res.category);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="category">
        Category <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <div className="flex gap-2">
        <NativeSelect id="category" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 flex-1">
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        {canEdit && !adding && (
          <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> New
          </Button>
        )}
      </div>
      {adding && (
        <div className="flex gap-2">
          <Input
            aria-label="New category name"
            placeholder="e.g. Drinks"
            className="h-11"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              } else if (e.key === "Escape") {
                setAdding(false);
              }
            }}
          />
          <Button type="button" className="h-11" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? "Adding…" : "Add"}
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
