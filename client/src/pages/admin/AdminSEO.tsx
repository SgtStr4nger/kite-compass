import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SeoAdminState } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Save, UploadCloud } from "lucide-react";

type SeoDraftForm = {
  homepageTitleDraft: string;
  homepageDescriptionDraft: string;
  exploreTitleDraft: string;
  exploreDescriptionDraft: string;
  methodologyTitleDraft: string;
  methodologyDescriptionDraft: string;
};

const emptyForm: SeoDraftForm = {
  homepageTitleDraft: "",
  homepageDescriptionDraft: "",
  exploreTitleDraft: "",
  exploreDescriptionDraft: "",
  methodologyTitleDraft: "",
  methodologyDescriptionDraft: "",
};

export default function AdminSEO() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<SeoDraftForm>(emptyForm);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: seo, isLoading, refetch } = useQuery<SeoAdminState>({
    queryKey: ["/api/admin/seo"],
    enabled: !!token,
  });

  useEffect(() => {
    if (!seo) return;
    setForm({
      homepageTitleDraft: seo.homepageTitleDraft,
      homepageDescriptionDraft: seo.homepageDescriptionDraft,
      exploreTitleDraft: seo.exploreTitleDraft,
      exploreDescriptionDraft: seo.exploreDescriptionDraft,
      methodologyTitleDraft: seo.methodologyTitleDraft,
      methodologyDescriptionDraft: seo.methodologyDescriptionDraft,
    });
  }, [seo]);

  const canPublish = useMemo(
    () => Object.values(form).every(value => value.trim().length > 0),
    [form],
  );

  const save = async () => {
    setBusy(true);
    try {
      await api("PATCH", "/api/admin/seo", form);
      toast({ title: "SEO changes saved" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not save SEO changes", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/admin/seo/publish");
      toast({ title: "SEO changes published" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not publish SEO changes", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: keyof SeoDraftForm, value: string) => setForm(current => ({ ...current, [key]: value }));

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">SEO</h1>
          <p className="text-sm text-muted-foreground">Shared draft and atomic publish for Homepage, Explore and Methodology metadata.</p>
          {seo?.publishedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">Last published: {new Date(seo.publishedAt).toLocaleString()}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save} disabled={busy} data-testid="button-seo-save">
            <Save className="mr-2 h-4 w-4" /> {busy ? "Saving…" : "Save SEO changes"}
          </Button>
          <Button onClick={publish} disabled={busy || !canPublish} data-testid="button-seo-publish">
            <UploadCloud className="mr-2 h-4 w-4" /> Publish SEO changes
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <SeoCard
            title="Homepage"
            titleValue={form.homepageTitleDraft}
            descriptionValue={form.homepageDescriptionDraft}
            onTitleChange={value => setField("homepageTitleDraft", value)}
            onDescriptionChange={value => setField("homepageDescriptionDraft", value)}
          />
          <SeoCard
            title="Explore"
            titleValue={form.exploreTitleDraft}
            descriptionValue={form.exploreDescriptionDraft}
            onTitleChange={value => setField("exploreTitleDraft", value)}
            onDescriptionChange={value => setField("exploreDescriptionDraft", value)}
          />
          <SeoCard
            title="Methodology"
            titleValue={form.methodologyTitleDraft}
            descriptionValue={form.methodologyDescriptionDraft}
            onTitleChange={value => setField("methodologyTitleDraft", value)}
            onDescriptionChange={value => setField("methodologyDescriptionDraft", value)}
          />
        </div>
      )}
    </AdminLayout>
  );
}

function SeoCard({
  title,
  titleValue,
  descriptionValue,
  onTitleChange,
  onDescriptionChange,
}: {
  title: string;
  titleValue: string;
  descriptionValue: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="mb-1.5 block">Meta title *</Label>
          <Input value={titleValue} onChange={(e) => onTitleChange(e.target.value)} />
        </div>
        <div>
          <Label className="mb-1.5 block">Meta description *</Label>
          <Input value={descriptionValue} onChange={(e) => onDescriptionChange(e.target.value)} />
        </div>
      </CardContent>
    </Card>
  );
}
