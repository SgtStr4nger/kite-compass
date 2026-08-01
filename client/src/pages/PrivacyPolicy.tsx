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

export default function PrivacyPolicy() {
  const preview = new URLSearchParams(getHashSearch()).get("preview") === "1";

  useEffect(() => {
    applyPageMetadata({
      title: "Privacy Policy | Kite Compass",
      description: "Learn how Kite Compass handles data and protects your privacy.",
      robots: preview ? "noindex,nofollow" : "index,follow",
      canonicalPath: "/privacy-policy",
    });
  }, [preview]);

  const previewQuery = preview ? "?preview=1" : "";
  const { data: page, isLoading } = useQuery<SitePage>({ queryKey: [`/api/pages/privacy-policy${previewQuery}`] });

  return (
    <SiteLayout>
      <div className="mx-auto max-w-3xl px-5 py-12 md:px-8">
        <div className="rounded-3xl border border-card-border bg-card p-6 md:p-8">
          <h1 className="font-serif text-4xl font-semibold text-foreground">Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">Published information about data protection and privacy handling.</p>
          <div className="mt-8">
            {isLoading ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : page ? (
              <Paragraphs body={page.body} />
            ) : (
              <p className="text-sm text-muted-foreground">No privacy policy content yet.</p>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
