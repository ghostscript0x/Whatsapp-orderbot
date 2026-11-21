"use client";

import * as React from "react";
import Link from "next/link";
import { EyeOff, FileUp, ImageOff, Plus, Search, SearchX, Tags, UtensilsCrossed } from "lucide-react";
import type { CategoryDto, ProductDto } from "@/lib/products";
import { apiFetch } from "@/lib/fetcher";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Label, Switch } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { errorMessage, plural } from "@/components/orders/format";
import { useDebounced } from "@/components/orders/hooks";
import { CategoryManager } from "./category-manager";
import { CsvImport } from "./csv-import";

type ListResponse = { products: ProductDto[]; canEdit: boolean; currency: string };

export function ProductsList() {
  const [search, setSearch] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const q = useDebounced(search.trim(), 300);

  const [data, setData] = React.useState<ListResponse | null>(null);
  const [categories, setCategories] = React.useState<CategoryDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const requestSeq = React.useRef(0);
  const loadProducts = React.useCallback(async () => {
    const params = new URLSearchParams({ includeUnavailable: "true" });
    if (q) params.set("q", q);
    if (categoryId) params.set("categoryId", categoryId);
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ListResponse>(`/api/products?${params}`);
      if (seq === requestSeq.current) setData(res);
    } catch (err) {
      if (seq === requestSeq.current) setError(errorMessage(err, "Couldn't load products"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [q, categoryId]);

  const loadCategories = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ categories: CategoryDto[] }>("/api/categories");
      setCategories(res.categories);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load categories"));
    }
  }, []);

  React.useEffect(() => {
    void loadProducts();
  }, [loadProducts]);
  React.useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const reloadAll = React.useCallback(async () => {
    await Promise.all([loadCategories(), loadProducts()]);
  }, [loadCategories, loadProducts]);

  async function toggleAvailable(p: ProductDto, available: boolean) {
    const setAvail = (v: boolean) => setData((d) => d && { ...d, products: d.products.map((x) => (x.id === p.id ? { ...x, available: v } : x)) });
    setAvail(available);
    try {
      await apiFetch(`/api/products/${p.id}`, { method: "PATCH", json: { available } });
      toast.success(available ? `${p.name} is available again` : `${p.name} is hidden from customers`);
    } catch (err) {
      setAvail(p.available);
      toast.error(`Couldn't update ${p.name}: ${errorMessage(err)}`);
    }
  }

  const canEdit = data?.canEdit ?? false;
  const currency = data?.currency ?? "NGN";
  const filtered = Boolean(q || categoryId);
  const hiddenCount = data?.products.filter((p) => !p.available).length ?? 0;

  const chips: { id: string; label: string }[] = [
    { id: "", label: "All" },
    ...categories.map((c) => ({ id: c.id, label: c.name })),
    ...(categories.length > 0 ? [{ id: "none", label: "Uncategorised" }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0"
        title="Products"
        description="What your bot can sell. Hidden products aren't offered to customers."
        actions={
          canEdit && (
            <>
              <CategoryManager categories={categories} onChanged={reloadAll}>
                <Button variant="outline" className="h-11 flex-1 sm:flex-none">
                  <Tags aria-hidden /> Categories
                </Button>
              </CategoryManager>
              <CsvImport onImported={reloadAll}>
                <Button variant="outline" className="h-11 flex-1 sm:flex-none">
                  <FileUp aria-hidden /> Import
                </Button>
              </CsvImport>
              <Button asChild className="h-11 w-full sm:w-auto">
                <Link href="/dashboard/products/new">
                  <Plus aria-hidden /> Add product
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="space-y-3">
        <div className="relative">
          <Label htmlFor="product-search" className="sr-only">
            Search products
          </Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="product-search" type="search" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 pl-9" />
        </div>
        {chips.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by category">
            {chips.map((c) => (
              <button
                key={c.id || "all"}
                type="button"
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  categoryId === c.id ? "border-transparent bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void loadProducts()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <GridSkeleton />
      ) : data.products.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No products match"
            description="Try another search or category."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setCategoryId("");
                }}
              >
                Show all products
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={UtensilsCrossed}
            title="No products yet"
            description="Add your menu so the bot can show prices and photos, and take orders."
            action={
              canEdit && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild className="h-11">
                    <Link href="/dashboard/products/new">
                      <Plus aria-hidden /> Add product
                    </Link>
                  </Button>
                  <CsvImport onImported={reloadAll}>
                    <Button variant="outline" className="h-11">
                      <FileUp aria-hidden /> Import CSV
                    </Button>
                  </CsvImport>
                </div>
              )
            }
          />
        )
      ) : (
        <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {plural(data.products.length, "product")}
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.products.map((p) => (
              <ProductCard key={p.id} product={p} currency={currency} canEdit={canEdit} onToggle={toggleAvailable} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product: p,
  currency,
  canEdit,
  onToggle,
}: {
  product: ProductDto;
  currency: string;
  canEdit: boolean;
  onToggle: (p: ProductDto, available: boolean) => void;
}) {
  const cover = p.images[0];
  const switchId = `avail-${p.id}`;
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <Link href={`/dashboard/products/${p.id}`} className="group flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <div className="relative aspect-[4/3] bg-muted">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- images live on tenant storage/external hosts
            <img
              src={cover.url}
              alt=""
              width={320}
              height={240}
              loading="lazy"
              className={cn("size-full object-cover transition-transform group-hover:scale-[1.02]", !p.available && "opacity-50 grayscale")}
            />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-6" aria-hidden />
              <span className="sr-only">No photo</span>
            </span>
          )}
          {!p.available && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm">
              <EyeOff className="size-3" aria-hidden /> Hidden
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-3">
          <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:underline">{p.name}</p>
          <p className="text-sm font-semibold tabular-nums">{formatMoney(p.priceKobo, currency)}</p>
          {p.categoryName && <p className="truncate text-xs text-muted-foreground">{p.categoryName}</p>}
        </div>
      </Link>
      <div className="flex min-h-12 items-center justify-between gap-2 border-t px-3">
        {canEdit ? (
          <>
            <Label htmlFor={switchId} className="text-xs text-muted-foreground">
              {p.available ? "Available" : "Hidden"}
              <span className="sr-only"> – {p.name}</span>
            </Label>
            <Switch id={switchId} checked={p.available} onCheckedChange={(v) => onToggle(p, v)} />
          </>
        ) : (
          <Badge variant={p.available ? "success" : "secondary"}>{p.available ? "Available" : "Hidden"}</Badge>
        )}
      </div>
    </li>
  );
}

function GridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-xl border">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
