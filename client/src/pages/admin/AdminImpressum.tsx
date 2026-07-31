import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SitePage } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { FileText, Save, RotateCcw } from "lucide-react";

const DEFAULT_BODY = [
  "Angaben gemäß § 5 TMG",
  "",
  "Kite Compass",
  "[Name des Betreibers / Unternehmens]",
  "[Straße und Hausnummer]",
  "[PLZ Ort]",
  "[Land]",
  "",
  "Kontakt",
  "E-Mail: [E-Mail-Adresse]",
  "Telefon: [optional]",
  "",
  "Vertretungsberechtigt",
  "[Name der vertretungsberechtigten Person]",
  "",
  "Haftung für Inhalte",
  "Die Inhalte dieser Website wurden mit Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen.",
  "",
  "Haftung für Links",
  "Diese Website enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.",
].join("\n");

export default function AdminImpressum() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [title, setTitle] = useState("Impressum");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: page, isLoading, refetch } = useQuery<SitePage>({
    queryKey: ["/api/admin/pages/impressum"],
    enabled: !!token,
  });

  useEffect(() => {
    if (page) {
      setTitle(page.title);
      setBody(page.body);
    }
  }, [page]);

  const save = async () => {
    setBusy(true);
    try {
      await api("PATCH", "/api/admin/pages/impressum", { title, body });
      toast({ title: "Impressum saved" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not save impressum", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTitle("Impressum");
    setBody(DEFAULT_BODY);
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Impressum</h1>
          <p className="text-sm text-muted-foreground">Editable public legal page, prefilled with a starter template.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={busy} data-testid="button-impressum-reset"><RotateCcw className="mr-2 h-4 w-4" /> Reset template</Button>
          <Button onClick={save} disabled={busy || !body.trim()} data-testid="button-impressum-save"><Save className="mr-2 h-4 w-4" /> {busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Content</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <Skeleton className="h-72 w-full rounded-xl" />
            ) : (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Title</label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Body</label>
                  <Textarea value={body} onChange={e => setBody(e.target.value)} rows={18} className="min-h-96 font-mono text-sm" data-testid="textarea-impressum-body" />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
              {body || "No content yet."}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
