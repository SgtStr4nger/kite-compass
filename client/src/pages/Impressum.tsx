import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { Skeleton } from "@/components/ui/skeleton";
import { SitePage } from "@/lib/types";

function Paragraphs({ body }: { body: string }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground/85">
      {body.split(/\n\n+/).map((block, index) => {
        const lines = block.split("\n").filter(Boolean);
        if (lines.length <= 1) return <p key={index}>{block}</p>;
        return (
          <div key={index} className="space-y-1">
            {lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
          </div>
        );
      })}
    </div>
  );
}

export default function Impressum() {
  const { data: page, isLoading } = useQuery<SitePage>({ queryKey: ["/api/pages/impressum"] });

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8">
        <div className="rounded-3xl border border-card-border bg-card p-6 md:p-8">
          <h1 className="font-serif text-4xl font-semibold text-foreground">{page?.title || "Impressum"}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Editable in the admin interface.</p>
          <div className="mt-8">
            {isLoading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : page ? (
              <Paragraphs body={page.body} />
            ) : (
              <p className="text-sm text-muted-foreground">No impressum content yet.</p>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
