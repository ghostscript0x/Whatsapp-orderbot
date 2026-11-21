import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Full-width message for pages the user cannot see (no business, suspended, not an admin). */
export function AccessNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto w-full max-w-lg p-4 sm:p-8">
      <Card role="alert">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
