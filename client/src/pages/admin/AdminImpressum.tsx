import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { LegalAdminState } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { FileText, Save, Eye, UploadCloud } from "lucide-react";

export default function AdminImpressum() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [privacyPolicyDraft, setPrivacyPolicyDraft] = useState("");
  const [legalNoticeDraft, setLegalNoticeDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: legal, isLoading, refetch } = useQuery<LegalAdminState>({
    queryKey: ["/api/admin/legal"],
    enabled: !!token,
  });

  useEffect(() => {
    if (!legal) return;
    setPrivacyPolicyDraft(legal.privacyPolicyDraft);
    setLegalNoticeDraft(legal.legalNoticeDraft);
  }, [legal]);

  const canPublish = useMemo(
    () => privacyPolicyDraft.trim().length > 0 && legalNoticeDraft.trim().length > 0,
    [privacyPolicyDraft, legalNoticeDraft],
  );

  const save = async () => {
    setBusy(true);
    try {
      await api("PATCH", "/api/admin/legal", { privacyPolicyDraft, legalNoticeDraft });
      toast({ title: "Legal changes saved" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not save legal changes", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/admin/legal/publish");
      toast({ title: "Legal changes published" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not publish legal changes", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Legal</h1>
          <p className="text-sm text-muted-foreground">Shared draft for Privacy Policy and Legal Notice.</p>
          {legal?.publishedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">Last published: {new Date(legal.publishedAt).toLocaleString()}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPreview(v => !v)} disabled={busy} data-testid="button-legal-preview">
            <Eye className="mr-2 h-4 w-4" /> {showPreview ? "Hide preview" : "View preview"}
          </Button>
          <Button variant="outline" onClick={save} disabled={busy} data-testid="button-legal-save">
            <Save className="mr-2 h-4 w-4" /> {busy ? "Saving…" : "Save legal changes"}
          </Button>
          <Button onClick={publish} disabled={busy || !canPublish} data-testid="button-legal-publish">
            <UploadCloud className="mr-2 h-4 w-4" /> Publish legal changes
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Privacy Policy</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-96 w-full rounded-xl" />
            ) : (
              <Textarea
                value={privacyPolicyDraft}
                onChange={(e) => setPrivacyPolicyDraft(e.target.value)}
                rows={18}
                className="min-h-96 font-mono text-sm"
                data-testid="textarea-privacy-policy-body"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Legal Notice</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-96 w-full rounded-xl" />
            ) : (
              <Textarea
                value={legalNoticeDraft}
                onChange={(e) => setLegalNoticeDraft(e.target.value)}
                rows={18}
                className="min-h-96 font-mono text-sm"
                data-testid="textarea-legal-notice-body"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {showPreview ? (
        <Card className="mt-4">
          <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Privacy Policy</h3>
              <div className="rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
                {privacyPolicyDraft || "No content yet."}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Legal Notice</h3>
              <div className="rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
                {legalNoticeDraft || "No content yet."}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AdminLayout>
  );
}
