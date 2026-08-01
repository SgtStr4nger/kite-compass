import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { Skeleton } from "@/components/ui/skeleton";
import { SitePage } from "@/lib/types";
import { applyPageMetadata } from "@/lib/metadata";
import { getHashSearch } from "@/lib/filterParams";

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
  const preview = new URLSearchParams(getHashSearch()).get("preview") === "1";

  useEffect(() => {
    applyPageMetadata({
      title: "Legal Notice | Kite Compass",
      description: "Legal information and contact details for Kite Compass.",
      robots: preview ? "noindex,nofollow" : "index,follow",
      canonicalPath: "/legal-notice",
    });
  }, [preview]);

  const previewQuery = preview ? "?preview=1" : "";
  const { data: page, isLoading } = useQuery<SitePage>({ queryKey: [`/api/pages/legal-notice${previewQuery}`] });

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8">
        <div className="rounded-3xl border border-card-border bg-card p-6 md:p-8">
          <h1 className="font-serif text-4xl font-semibold text-foreground">Legal Notice</h1>
          <p className="mt-3 text-sm text-muted-foreground">Published legal contact and provider details.</p>
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
