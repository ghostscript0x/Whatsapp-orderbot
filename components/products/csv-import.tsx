"use client";

import * as React from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { errorMessage, plural } from "@/components/orders/format";

type ImportResult = { created: number; errors: { row: number; message: string }[] };

const SAMPLE_CSV = [
  "name,price,description,category,image_url",
  'Jollof rice,"1,500",Smoky party jollof with fried plantain,Mains,https://example.com/images/jollof.jpg',
  "Chicken suya,2000,Spicy grilled chicken skewers,Grills,",
  "Chapman,800,Chilled fruity mocktail,Drinks,",
].join("\n");

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "products-sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Dialog to bulk-import products from a CSV. `children` is the trigger button. */
export function CsvImport({ onImported, children }: { onImported: () => Promise<void>; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function onOpenChange(o: boolean) {
    if (busy) return;
    if (!o) {
      setFile(null);
      setError(null);
      setResult(null);
    }
    setOpen(o);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/products/import", { method: "POST", body });
      const text = await res.text();
      let data: (ImportResult & { error?: { message?: string } }) | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Import failed (${res.status}): the server sent an unexpected response`);
      }
      if (!res.ok || !data) throw new Error(data?.error?.message ?? `Import failed (${res.status})`);
      setResult(data);
      if (data.created > 0) {
        toast.success(`${plural(data.created, "product")} imported`);
        await onImported();
      }
    } catch (err) {
      setError(errorMessage(err, "Import failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Import products from CSV" description="Up to 500 rows. Missing categories are created for you." hideClose={busy}>
        {result ? (
          <div className="space-y-4 text-sm" role="status">
            <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div>
                <p className="font-medium">{plural(result.created, "product")} imported</p>
                {result.errors.length > 0 && <p className="text-muted-foreground">{plural(result.errors.length, "row")} skipped. Fix them in your file and import again.</p>}
              </div>
            </div>
            {result.errors.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border" aria-label="Skipped rows">
                {result.errors.map((e, i) => (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    {e.row > 0 && <span className="shrink-0 font-medium tabular-nums">Row {e.row}</span>}
                    <span className="text-destructive">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setResult(null);
                  setFile(null);
                }}
              >
                Import another file
              </Button>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 text-sm">
            <div className="rounded-lg bg-muted p-3">
              <p>
                Columns: <code>name</code> and <code>price</code> (required, e.g. 1500 or 1,500.50), <code>description</code>, <code>category</code>,{" "}
                <code>image_url</code>.
              </p>
              <Button type="button" variant="link" className="h-10 px-0" onClick={downloadSample}>
                <Download aria-hidden /> Download a sample file
              </Button>
            </div>

            <input
              ref={inputRef}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
                e.target.value = "";
              }}
            />
            <label
              htmlFor="csv-file"
              className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring"
            >
              <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden />
              {file ? (
                <>
                  <span className="max-w-full truncate font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">Tap to choose a different file</span>
                </>
              ) : (
                <>
                  <span className="font-medium">Choose a CSV file</span>
                  <span className="text-xs text-muted-foreground">Tap to browse</span>
                </>
              )}
            </label>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" className="h-11" disabled={!file || busy}>
                {busy ? <Spinner /> : <Upload aria-hidden />}
                {busy ? "Importing…" : "Import products"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
