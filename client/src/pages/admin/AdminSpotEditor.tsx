import { useEffect, useState, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { SpotDetail, MonthlyRecord, MONTHS, tagLabel, School, Stay, SCHOOL_SPORTS, STAY_TYPES } from "@/lib/types";
import { ArrowLeft, Eye, Save, Trash2, Upload, Plus, CloudDownload, RefreshCw, CheckCircle2, AlertTriangle, CheckCheck, ChevronUp, ChevronDown, Link as LinkIcon } from "lucide-react";

const SPOT_TYPES = ["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"];
const RIDER_LEVELS = ["beginner", "intermediate", "advanced"];
const VIBE_TAGS = ["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"];
const SEASONS = ["peak", "side", "off"];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function automaticSpotSeoTitle(name: string | undefined, country: string | undefined) {
  const spotName = (name || "").trim() || "Spot";
  const spotCountry = (country || "").trim() || "Unknown location";
  return `${spotName}, ${spotCountry} – Kitesurfing Guide | Kite Compass`;
}

function automaticSpotSeoDescription(name: string | undefined, country: string | undefined) {
  const spotName = (name || "").trim() || "Spot";
  const spotCountry = (country || "").trim() || "Unknown location";
  return `Explore kitesurfing conditions, seasonality and travel information for ${spotName}, ${spotCountry}.`;
}

type SpotForm = Partial<SpotDetail>;

export default function AdminSpotEditor() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/admin/spots/:id");
  const { toast } = useToast();
  const isNew = params?.id === "new";
  const id = isNew ? null : Number(params?.id);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: loaded } = useQuery<SpotDetail>({
    queryKey: [`/api/admin/spots/${id}`], enabled: !!token && !!id,
  });

  const [form, setForm] = useState<SpotForm>({
    name: "", slug: "", country: "", region: "", latitude: null, longitude: null,
    googleMapsUrl: "", windyUrl: "", windfinderUrl: "",
    destinationSummary: "", destinationDescription: "", kiteContextDescription: "", teaserText: "",
    heroImageUrl: "", nearestAirportName: "", nearestAirportCode: "", airportTransferTime: "", transportNote: "",
    beginnerFriendly: false, spotTypes: [], riderLevels: [], vibeTags: [],
    seoTitleOverride: "", seoDescriptionOverride: "",
    sourceNotes: "", internalNotes: "", rankingMode: "auto",
    published: false, hasDraft: true,
  });
  const [monthly, setMonthly] = useState<MonthlyRecord[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [importJson, setImportJson] = useState("");
  const [savedId, setSavedId] = useState<number | null>(id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded) {
      const { monthly: m, schools: sc, stays: st, ...rest } = loaded;
      setForm(rest);
      setMonthly(m);
      setSchools(sc ?? []);
      setStays(st ?? []);
      setSavedId(loaded.id);
    }
  }, [loaded]);

  const set = (k: keyof SpotForm, v: any) => setForm(f => ({ ...f, [k]: v }));
  const toggleArr = (k: "spotTypes" | "riderLevels" | "vibeTags", v: string) =>
    setForm(f => {
      const arr = (f[k] as string[]) || [];
      return { ...f, [k]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] };
    });

  const saveSpot = async (): Promise<number | null> => {
    setBusy(true);
    try {
      const payload = { ...form, slug: form.slug || slugify(form.name || "") };
      let sid = savedId;
      if (isNew && !savedId) {
        const created = await api<SpotDetail>("POST", "/api/admin/spots", payload);
        sid = created.id; setSavedId(created.id);
        navigate(`/admin/spots/${created.id}`, { replace: true });
      } else {
        await api("PATCH", `/api/admin/spots/${sid}`, payload);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/spots"] });
      if (sid) await queryClient.invalidateQueries({ queryKey: [`/api/admin/spots/${sid}`] });
      toast({ title: "Draft saved" });
      return sid;
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e.message || e), variant: "destructive" });
      return null;
    } finally { setBusy(false); }
  };

  const publishSpot = async () => {
    const sid = await saveSpot();
    if (!sid) return;
    await api("POST", `/api/admin/spots/${sid}/publish`);
    await queryClient.invalidateQueries({ queryKey: [`/api/admin/spots/${sid}`] });
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/spots"] });
    setForm(f => ({ ...f, published: true, hasDraft: false }));
    toast({ title: "Spot published" });
  };

  const deleteSpot = async () => {
    if (!savedId) return;
    if (!window.confirm(`Move "${form.name || "this spot"}" to Trash? It will be permanently deleted after 30 days.`)) return;
    try {
      await api("DELETE", `/api/admin/spots/${savedId}`);
      toast({ title: "Spot moved to Trash" });
      navigate("/admin/spots");
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  // ── Weather enrichment (Open-Meteo, Pattern B: explicit admin action) ──
  const [enriching, setEnriching] = useState(false);
  const hasCoords = form.latitude != null && form.longitude != null;
  const enrich = async () => {
    // Persist any unsaved coordinate edits first so the server reads current values.
    const sid = await saveSpot();
    if (!sid) return;
    setEnriching(true);
    try {
      const out = await api<any>("POST", `/api/admin/spots/${sid}/enrich`);
      // Reload the spot so the monthly rows + refresh metadata reflect new drafts.
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/spots/${sid}`] });
      const fresh = await api<SpotDetail>("GET", `/api/admin/spots/${sid}`);
      const { monthly: m, ...rest } = fresh;
      setForm(rest); setMonthly(m);
      toast({
        title: `Weather data refreshed — ${out.monthsWritten} months`,
        description: (out.waveAvailable ? "Wind + wave data applied as drafts. " : "Wind applied; no wave coverage here. ") +
          "Review and publish months to go live." + (out.qualityNote ? ` (${out.qualityNote})` : ""),
      });
    } catch (e: any) {
      toast({ title: "Enrichment failed", description: String(e.message || e) + " — existing data was left unchanged.", variant: "destructive" });
    } finally { setEnriching(false); }
  };

  const preview = async () => {
    const sid = await saveSpot();
    if (sid && form.slug) window.open(`#/spots/${form.slug || slugify(form.name || "")}?preview=1`, "_blank");
  };

  const exportSpot = async () => {
    const sid = await saveSpot();
    if (!sid) return;
    const data = await api<any>("GET", `/api/admin/spots/${sid}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const importSpot = async () => {
    const sid = await saveSpot();
    if (!sid) return;
    if (!importJson.trim()) { toast({ title: "Paste export JSON first", variant: "destructive" }); return; }
    try {
      const payload = JSON.parse(importJson);
      const fresh = await api<SpotDetail>("POST", `/api/admin/spots/${sid}/import`, payload);
      const { monthly: m, schools: sc, stays: st, ...rest } = fresh;
      setForm(rest); setMonthly(m); setSchools(sc ?? []); setStays(st ?? []);
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/spots/${sid}`] });
      toast({ title: "Import complete" });
    } catch (e: any) {
      toast({ title: "Import failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  // ── Monthly record helpers ──
  const usedMonths = monthly.map(m => m.month);
  const addMonth = async (month: string) => {
    if (!savedId) { toast({ title: "Save the spot first", variant: "destructive" }); return; }
    const rec = await api<MonthlyRecord>("POST", "/api/admin/monthly", {
      spotId: savedId, month, seasonLabel: "side", published: false, hasDraft: true,
    });
    setMonthly(m => [...m, rec]);
  };
  const updateMonthLocal = (mid: number, patch: Partial<MonthlyRecord>) =>
    setMonthly(ms => ms.map(m => m.id === mid ? { ...m, ...patch } : m));
  const saveMonth = async (rec: MonthlyRecord) => {
    await api("PATCH", `/api/admin/monthly/${rec.id}`, rec);
    updateMonthLocal(rec.id, { hasDraft: true });
    toast({ title: `${rec.month} saved` });
  };
  const publishMonth = async (rec: MonthlyRecord) => {
    await api("PATCH", `/api/admin/monthly/${rec.id}`, rec);
    await api("POST", `/api/admin/monthly/${rec.id}/publish`);
    updateMonthLocal(rec.id, { published: true, hasDraft: false });
    toast({ title: `${rec.month} published` });
  };
  const publishAllMonths = async () => {
    if (!savedId) return;
    await saveSpot();
    const out = await api<{ publishedCount: number }>("POST", `/api/admin/spots/${savedId}/monthly/publish`);
    await queryClient.invalidateQueries({ queryKey: [`/api/admin/spots/${savedId}`] });
    const fresh = await api<SpotDetail>("GET", `/api/admin/spots/${savedId}`);
    const { monthly: m, schools: sc, stays: st, ...rest } = fresh;
    setForm(rest); setMonthly(m); setSchools(sc ?? []); setStays(st ?? []);
    toast({ title: `Published ${out.publishedCount} monthly records` });
  };
  const deleteMonth = async (mid: number) => {
    await api("DELETE", `/api/admin/monthly/${mid}`);
    setMonthly(ms => ms.filter(m => m.id !== mid));
  };

  const autoSeoTitle = automaticSpotSeoTitle(form.name, form.country);
  const autoSeoDescription = automaticSpotSeoDescription(form.name, form.country);
  const effectiveSeoTitle = form.seoTitleOverride?.trim() ? form.seoTitleOverride.trim() : autoSeoTitle;
  const effectiveSeoDescription = form.seoDescriptionOverride?.trim() ? form.seoDescriptionOverride.trim() : autoSeoDescription;
  const titleWarning = effectiveSeoTitle.length > 60;
  const descriptionWarning = effectiveSeoDescription.length > 160;

  return (
    <AdminLayout>
      {/* header / action bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate("/admin/spots")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-admin">
          <ArrowLeft className="h-4 w-4" /> All spots
        </button>
        <div className="flex items-center gap-2">
          {savedId && (
            <Button variant="ghost" size="icon" onClick={deleteSpot} disabled={busy} title="Move to Trash" className="text-muted-foreground hover:text-destructive" data-testid="button-delete-spot">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={exportSpot} disabled={busy} className="gap-2" data-testid="button-export-spot"><Upload className="h-4 w-4" /> Export</Button>
          <Button variant="outline" onClick={preview} disabled={busy || !form.name} className="gap-2" data-testid="button-preview"><Eye className="h-4 w-4" /> Preview</Button>
          <Button variant="outline" onClick={saveSpot} disabled={busy} className="gap-2" data-testid="button-save-draft"><Save className="h-4 w-4" /> Save draft</Button>
          <Button onClick={publishSpot} disabled={busy} data-testid="button-publish-spot">Publish spot</Button>
        </div>
      </div>

      <h1 className="mb-1 font-serif text-2xl font-semibold text-foreground">{form.name || "New spot"}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {form.published ? (form.hasDraft ? "Published — with unpublished draft edits" : "Published") : "Draft — not visible on the public site"}
      </p>

      <div className="space-y-8">
        {/* Basics */}
        <Section title="Basics">
          <Field label="Name" required><Input value={form.name || ""} onChange={e => { const v = e.target.value; set("name", v); if (isNew && !savedId) set("slug", slugify(v)); }} data-testid="input-name" /></Field>
          <Field label="Slug (URL)" hint="Used in the address, e.g. /spots/el-medano"><Input value={form.slug || ""} onChange={e => set("slug", slugify(e.target.value))} data-testid="input-slug" /></Field>
          <Field label="Public ID" hint="Stable identifier for exports and imports"><Input value={form.publicId || "—"} disabled data-testid="input-public-id" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Country"><Input value={form.country || ""} onChange={e => set("country", e.target.value)} data-testid="input-country" /></Field>
            <Field label="Region"><Input value={form.region || ""} onChange={e => set("region", e.target.value)} data-testid="input-region" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Latitude"><Input type="number" step="any" value={form.latitude ?? ""} onChange={e => set("latitude", e.target.value === "" ? null : Number(e.target.value))} data-testid="input-lat" /></Field>
            <Field label="Longitude"><Input type="number" step="any" value={form.longitude ?? ""} onChange={e => set("longitude", e.target.value === "" ? null : Number(e.target.value))} data-testid="input-lng" /></Field>
          </div>
          <Field label="Hero image URL" hint="Leave blank to use the default placeholder"><Input value={form.heroImageUrl || ""} onChange={e => set("heroImageUrl", e.target.value)} data-testid="input-hero" /></Field>
        </Section>

        {/* Content */}
        <Section title="Content">
          <Field label="Teaser" hint="Short line shown on result cards (editable, stored separately)"><Textarea rows={2} value={form.teaserText || ""} onChange={e => set("teaserText", e.target.value)} data-testid="input-teaser" /></Field>
          <Field label="Summary" hint="One-liner at the top of the spot page"><Textarea rows={2} value={form.destinationSummary || ""} onChange={e => set("destinationSummary", e.target.value)} data-testid="input-summary" /></Field>
          <Field label="Destination description"><Textarea rows={4} value={form.destinationDescription || ""} onChange={e => set("destinationDescription", e.target.value)} data-testid="input-destdesc" /></Field>
          <Field label="Kite context description"><Textarea rows={4} value={form.kiteContextDescription || ""} onChange={e => set("kiteContextDescription", e.target.value)} data-testid="input-kitedesc" /></Field>

          <Collapsible defaultOpen={false}>
            <div className="rounded-xl border border-border">
              <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
                <div>
                  <p className="font-medium text-foreground">SEO</p>
                  <p className="text-xs text-muted-foreground">Optional per-spot overrides for title and description.</p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border px-4 py-4">
                <div className="space-y-4">
                  <Field label="Meta title override" hint={`Automatic: ${autoSeoTitle}`}>
                    <div className="space-y-2">
                      <Input
                        value={form.seoTitleOverride || ""}
                        onChange={e => set("seoTitleOverride", e.target.value)}
                        data-testid="input-seo-title-override"
                      />
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Effective title: {effectiveSeoTitle}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => set("seoTitleOverride", "")} data-testid="button-seo-title-reset">
                          Reset to automatic
                        </Button>
                      </div>
                    </div>
                  </Field>
                  {titleWarning ? (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700" data-testid="text-seo-title-warning">
                      <AlertTriangle className="h-3.5 w-3.5" /> Title is over ~60 characters (warning only).
                    </p>
                  ) : null}

                  <Field label="Meta description override" hint={`Automatic: ${autoSeoDescription}`}>
                    <div className="space-y-2">
                      <Textarea
                        rows={3}
                        value={form.seoDescriptionOverride || ""}
                        onChange={e => set("seoDescriptionOverride", e.target.value)}
                        data-testid="input-seo-description-override"
                      />
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Effective description: {effectiveSeoDescription}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => set("seoDescriptionOverride", "")} data-testid="button-seo-description-reset">
                          Reset to automatic
                        </Button>
                      </div>
                    </div>
                  </Field>
                  {descriptionWarning ? (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700" data-testid="text-seo-description-warning">
                      <AlertTriangle className="h-3.5 w-3.5" /> Description is over ~160 characters (warning only).
                    </p>
                  ) : null}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </Section>

        {/* Import / export */}
        <Section title="Import / export" hint="Export writes the current spot, monthly records, schools and stays as JSON; paste it back here to restore the same structure.">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportSpot} disabled={busy} className="gap-2" data-testid="button-export-spot-inline"><Upload className="h-4 w-4" /> Export JSON</Button>
            <Button onClick={importSpot} disabled={busy} className="gap-2" data-testid="button-import-spot"><CloudDownload className="h-4 w-4" /> Import JSON</Button>
          </div>
          <Textarea rows={8} value={importJson} onChange={e => setImportJson(e.target.value)} placeholder="Paste exported JSON here" data-testid="textarea-import-json" />
        </Section>

        {/* Tags */}
        <Section title="Classification">
          <TagGroup label="Spot types" options={SPOT_TYPES} selected={form.spotTypes || []} onToggle={v => toggleArr("spotTypes", v)} testid="spottype" />
          <TagGroup label="Rider levels" options={RIDER_LEVELS} selected={form.riderLevels || []} onToggle={v => toggleArr("riderLevels", v)} testid="riderlevel" />
          <TagGroup label="Travel vibe" options={VIBE_TAGS} selected={form.vibeTags || []} onToggle={v => toggleArr("vibeTags", v)} testid="vibe" />
          <div className="flex items-center gap-2 pt-1">
            <Checkbox id="beg" checked={!!form.beginnerFriendly} onCheckedChange={c => set("beginnerFriendly", !!c)} data-testid="input-beginner" />
            <Label htmlFor="beg" className="cursor-pointer">Beginner friendly</Label>
          </div>
        </Section>

        {/* Travel */}
        <Section title="Getting there">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nearest airport"><Input value={form.nearestAirportName || ""} onChange={e => set("nearestAirportName", e.target.value)} data-testid="input-airport" /></Field>
            <Field label="Airport code"><Input value={form.nearestAirportCode || ""} onChange={e => set("nearestAirportCode", e.target.value)} data-testid="input-airportcode" /></Field>
          </div>
          <Field label="Transfer time"><Input value={form.airportTransferTime || ""} onChange={e => set("airportTransferTime", e.target.value)} data-testid="input-transfer" /></Field>
          <Field label="Transport note"><Textarea rows={2} value={form.transportNote || ""} onChange={e => set("transportNote", e.target.value)} data-testid="input-transport" /></Field>
        </Section>

        {/* External links */}
        <Section title="External links" hint="Forecast buttons only appear on the public page when a URL is set">
          <Field label="Google Maps URL"><Input value={form.googleMapsUrl || ""} onChange={e => set("googleMapsUrl", e.target.value)} data-testid="input-gmaps" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Windy URL"><Input value={form.windyUrl || ""} onChange={e => set("windyUrl", e.target.value)} data-testid="input-windy" /></Field>
            <Field label="Windfinder URL"><Input value={form.windfinderUrl || ""} onChange={e => set("windfinderUrl", e.target.value)} data-testid="input-windfinder" /></Field>
          </div>
        </Section>

        {/* Ranking mode — ADMIN ONLY, never public */}
        <Section title="Ranking" hint="This control is admin-only and never shown to visitors">
          <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-4">
            <div>
              <div className="font-medium text-foreground">Scoring mode: {form.rankingMode === "auto" ? "Automatic (wind)" : "Manual"}</div>
              <p className="text-sm text-muted-foreground">Manual uses the score you enter per month. Automatic derives it from the weather data and keeps the monthly season label in sync.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Manual</span>
              <Switch checked={form.rankingMode === "auto"} onCheckedChange={c => set("rankingMode", c ? "auto" : "manual")} data-testid="switch-ranking-mode" />
              <span className="text-sm text-muted-foreground">Auto</span>
            </div>
          </div>
        </Section>

        {/* Weather data (Open-Meteo enrichment) */}
        <Section title="Weather data" hint="Multi-year Open-Meteo averages (2015–2024). Fills wind & wave metrics as drafts — your season labels and manual scores are always kept.">
          <div className="rounded-xl border border-border bg-secondary/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {form.dataLastRefreshedAt ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <CloudDownload className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium text-foreground" data-testid="text-enrich-status">
                    {form.dataLastRefreshedAt ? "Weather data present" : "Not enriched yet"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {form.dataLastRefreshedAt
                    ? <>Last refreshed {new Date(form.dataLastRefreshedAt).toLocaleString()} · source Open-Meteo</>
                    : <>Pull monthly wind & wave averages from Open-Meteo. Saved as drafts for you to review and publish.</>}
                </p>
                {form.dataQualityNote ? (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {form.dataQualityNote}
                  </p>
                ) : null}
                {!hasCoords ? (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700" data-testid="text-enrich-nocoords">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Add latitude & longitude above, then save, to enable enrichment.
                  </p>
                ) : null}
              </div>
              <Button onClick={enrich} disabled={enriching || busy || !hasCoords} className="gap-2 shrink-0" data-testid="button-enrich">
                <RefreshCw className={`h-4 w-4 ${enriching ? "animate-spin" : ""}`} />
                {enriching ? "Refreshing…" : form.dataLastRefreshedAt ? "Refresh weather data" : "Enrich weather data"}
              </Button>
            </div>
          </div>
        </Section>

        {/* Monthly records */}
        <Section title="Monthly records" hint={savedId ? "Publish months separately from the spot" : "Save the spot first to add monthly records"}>
          {savedId && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Add month:</span>
              {MONTHS.filter(m => !usedMonths.includes(m)).map(m => (
                <button key={m} onClick={() => addMonth(m)} className="rounded-full border border-border px-2.5 py-1 text-xs hover-elevate" data-testid={`add-month-${m}`}>
                  <Plus className="mr-0.5 inline h-3 w-3" />{m}
                </button>
              ))}
              {MONTHS.filter(m => !usedMonths.includes(m)).length === 0 && <span className="text-xs text-muted-foreground">All 12 months added.</span>}
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={publishAllMonths} data-testid="button-publish-all-months">
                  <CheckCheck className="mr-2 h-4 w-4" /> Publish all months
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {MONTHS.map(mn => monthly.find(m => m.month === mn)).filter(Boolean).map(rec => (
              <MonthlyRow key={(rec as MonthlyRecord).id} rec={rec as MonthlyRecord} autoMode={form.rankingMode === "auto"}
                onChange={patch => updateMonthLocal((rec as MonthlyRecord).id, patch)}
                onSave={() => saveMonth(monthly.find(m => m.id === (rec as MonthlyRecord).id)!)}
                onPublish={() => publishMonth(monthly.find(m => m.id === (rec as MonthlyRecord).id)!)}
                onDelete={() => deleteMonth((rec as MonthlyRecord).id)} />
            ))}
          </div>
        </Section>

        {/* Linked schools */}
        <Section title="Schools" hint={savedId ? "Assigned kite schools (drag to reorder, max 3 shown publicly)" : "Save the spot first to manage schools"}>
          {savedId && <SpotListingEditor
            kind="school"
            spotId={savedId}
            items={schools}
            setItems={setSchools}
          />}
        </Section>

        {/* Linked stays */}
        <Section title="Stays" hint={savedId ? "Assigned stays (drag to reorder, max 3 shown publicly)" : "Save the spot first to manage stays"}>
          {savedId && <SpotListingEditor
            kind="stay"
            spotId={savedId}
            items={stays}
            setItems={setStays}
          />}
        </Section>
      </div>
    </AdminLayout>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-card-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">{title}</h2>
      {hint && <p className="mb-4 mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className={`${hint ? "" : "mt-4"} space-y-4`}>{children}</div>
    </section>
  );
}
function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}{required && <span className="text-accent"> *</span>}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
function TagGroup({ label, options, selected, onToggle, testid }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; testid: string }) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o} type="button" onClick={() => onToggle(o)} data-testid={`tag-${testid}-${o}`}
            className={`rounded-full border px-3 py-1 text-sm ${selected.includes(o) ? "border-primary bg-primary text-primary-foreground" : "border-border hover-elevate"}`}>
            {tagLabel(o)}
          </button>
        ))}
      </div>
    </div>
  );
}
function MonthlyRow({ rec, autoMode, onChange, onSave, onPublish, onDelete }: {
  rec: MonthlyRecord; autoMode: boolean;
  onChange: (p: Partial<MonthlyRecord>) => void; onSave: () => void; onPublish: () => void; onDelete: () => void;
}) {
  const num = (v: string) => v === "" ? null : Number(v);
  return (
    <div className="rounded-xl border border-border p-4" data-testid={`monthly-row-${rec.month}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="font-medium text-foreground">{rec.month}</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${rec.published && !rec.hasDraft ? "text-emerald-700" : rec.published ? "text-amber-700" : "text-stone-500"}`}>
            {rec.published && !rec.hasDraft ? "Published" : rec.published ? "Draft edits" : "Draft"}
          </span>
          <Button size="sm" variant="ghost" onClick={onDelete} data-testid={`button-delete-month-${rec.month}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SmallField label="Manual score">
          <Input type="number" step="0.1" value={rec.manualScore ?? ""} onChange={e => onChange({ manualScore: num(e.target.value) })} data-testid={`input-manualscore-${rec.month}`} />
        </SmallField>
        <SmallField label="Kiteable wind (kn)">
          <Input type="number" step="any" value={rec.avgKiteableWind10mKnots ?? ""} onChange={e => onChange({ avgKiteableWind10mKnots: num(e.target.value), averageBaseWind: num(e.target.value) })} data-testid={`input-avgkitewind-${rec.month}`} />
        </SmallField>
        <SmallField label="Kiteable days">
          <Input type="number" value={rec.kiteableDaysCount ?? ""} onChange={e => onChange({ kiteableDaysCount: num(e.target.value), windDays: num(e.target.value) })} data-testid={`input-kitedays-${rec.month}`} />
        </SmallField>
        <SmallField label="Kiteable hours/day">
          <Input type="number" step="any" value={rec.avgKiteableHoursPerDay ?? ""} onChange={e => onChange({ avgKiteableHoursPerDay: num(e.target.value) })} data-testid={`input-kitehours-${rec.month}`} />
        </SmallField>
        <SmallField label={autoMode ? "Season (automatic)" : "Season"}>
          <select
            value={rec.seasonLabel}
            onChange={e => onChange({ seasonLabel: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            data-testid={`select-season-${rec.month}`}
            disabled={autoMode}
            title={autoMode ? "Derived automatically from the score" : undefined}
          >
            {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </SmallField>
        {autoMode && (
          <SmallField label="Auto score">
            <Input type="number" step="0.1" value={rec.automaticWindScore ?? ""} disabled title="Computed automatically from weather data" />
          </SmallField>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onSave} data-testid={`button-save-month-${rec.month}`}>Save</Button>
        <Button size="sm" onClick={onPublish} data-testid={`button-publish-month-${rec.month}`}>Publish</Button>
      </div>
    </div>
  );
}
function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs text-muted-foreground">{label}</label>{children}</div>;
}

function SpotListingEditor({ kind, spotId, items, setItems }: {
  kind: "school" | "stay";
  spotId: number;
  items: any[];
  setItems: React.Dispatch<React.SetStateAction<any[]>>;
}) {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAssignSearch, setShowAssignSearch] = useState(false);
  const [newName, setNewName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const basePath = `/api/admin/spots/${spotId}/${kind === "school" ? "school" : "stay"}-assignments`;

  const reload = useCallback(async () => {
    const rows = await api<any[]>("GET", basePath);
    setItems(rows);
  }, [basePath, setItems]);

  const createAndAssign = async () => {
    if (!newName.trim()) return;
    try {
      await api("POST", `${basePath}/create-and-assign`, { name: newName.trim() });
      await reload();
      setNewName(""); setShowCreateForm(false);
      toast({ title: `${kind === "school" ? "School" : "Stay"} created and assigned` });
    } catch (e: any) { toast({ title: "Failed", description: String(e.message || e), variant: "destructive" }); }
  };

  const searchListings = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const listPath = kind === "school" ? "/api/admin/listings/schools" : "/api/admin/listings/stays";
      const result = await api<any>("GET", `${listPath}?search=${encodeURIComponent(q)}&perPage=20`);
      // Filter out already-assigned ones
      const assignedIds = new Set(items.map((i: any) => i.id));
      setSearchResults((result.items || []).filter((r: any) => !assignedIds.has(r.id)));
    } catch { setSearchResults([]); }
  };

  const assignExisting = async (id: number) => {
    try {
      await api("POST", `${basePath}/assign`, kind === "school" ? { schoolId: id } : { stayId: id });
      await reload();
      setShowAssignSearch(false); setSearchQuery(""); setSearchResults([]);
      toast({ title: "Assigned" });
    } catch (e: any) {
      const msg = String((e as any).message || e);
      toast({ title: msg.includes("already assigned") ? "Already assigned to this spot" : "Failed", description: msg, variant: "destructive" });
    }
  };

  const unassign = async (id: number) => {
    await api("DELETE", `${basePath}/${id}`);
    await reload();
    toast({ title: "Removed from spot" });
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setItems(next);
    await api("PATCH", `${basePath}/reorder`, { orderedIds: next.map((i: any) => i.id) });
  };

  const moveDown = async (idx: number) => {
    if (idx >= items.length - 1) return;
    const next = [...items];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setItems(next);
    await api("PATCH", `${basePath}/reorder`, { orderedIds: next.map((i: any) => i.id) });
  };

  const update = async (id: number, patch: any) => {
    const listPath = kind === "school" ? `/api/admin/listings/schools/${id}` : `/api/admin/listings/stays/${id}`;
    const updated = await api<any>("PATCH", listPath, patch);
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updated } : item));
  };

  const publish = async (id: number) => {
    const listPath = kind === "school" ? `/api/admin/listings/schools/${id}/publish` : `/api/admin/listings/stays/${id}/publish`;
    const updated = await api<any>("POST", listPath);
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updated } : item));
    toast({ title: "Published" });
  };

  const toggleExpanded = (id: number) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { setShowCreateForm(v => !v); setShowAssignSearch(false); }} className="gap-2">
          <Plus className="h-4 w-4" /> Create &amp; assign
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setShowAssignSearch(v => !v); setShowCreateForm(false); }} className="gap-2">
          <LinkIcon className="h-4 w-4" /> Assign existing
        </Button>
      </div>

      {showCreateForm && (
        <div className="flex items-center gap-2 rounded-xl border border-border p-3">
          <Input placeholder={`${kind === "school" ? "School" : "Stay"} name`} value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createAndAssign(); }} className="flex-1" autoFocus />
          <Button size="sm" onClick={createAndAssign} disabled={!newName.trim()}>Create</Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowCreateForm(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {showAssignSearch && (
        <div className="rounded-xl border border-border p-3 space-y-2">
          <Input placeholder={`Search ${kind === "school" ? "schools" : "stays"}…`} value={searchQuery}
            onChange={e => searchListings(e.target.value)} autoFocus />
          {searchResults.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => assignExisting(r.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                  <span>{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.published ? "Published" : "Draft"}</span>
                </button>
              ))}
            </div>
          ) : searchQuery ? (
            <p className="text-sm text-muted-foreground">No results</p>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => { setShowAssignSearch(false); setSearchQuery(""); setSearchResults([]); }}>Cancel</Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {kind === "school" ? "schools" : "stays"} assigned.</p>
      ) : items.map((item, idx) => (
        <div key={item.id} className="rounded-xl border border-border">
          <div className="flex items-center gap-2 p-3">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(idx)} disabled={idx === 0} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
              <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground truncate">{item.name}</div>
              <div className="text-xs text-muted-foreground">
                {item.published && !item.hasDraft ? "Published" : item.published ? "Draft edits" : "Draft"}
                {idx < 3 && <span className="ml-1.5 text-emerald-700">· visible publicly</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => toggleExpanded(item.id)}>
                {expanded[item.id] ? "Less" : "Edit"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => publish(item.id)} title="Publish">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => unassign(item.id)} title="Remove from spot">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>

          {expanded[item.id] && (
            <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <SmallField label="Name">
                  <Input value={item.name} onChange={e => update(item.id, { name: e.target.value })} />
                </SmallField>
                <SmallField label="Website">
                  <Input value={item.websiteUrl || ""} onChange={e => update(item.id, { websiteUrl: e.target.value })} />
                </SmallField>
                <SmallField label="Google Maps link">
                  <Input value={item.mapUrl || ""} onChange={e => update(item.id, { mapUrl: e.target.value })} />
                </SmallField>
                {kind === "stay" && (
                  <SmallField label="Type">
                    <select value={item.type || ""} onChange={e => update(item.id, { type: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      <option value="">— Select type —</option>
                      {STAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </SmallField>
                )}
              </div>
              {kind === "school" && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Sports</label>
                  <div className="flex flex-wrap gap-2">
                    {SCHOOL_SPORTS.map(s => (
                      <button key={s} type="button"
                        onClick={() => {
                          const sp: string[] = Array.isArray(item.sports) ? item.sports : [];
                          update(item.id, { sports: sp.includes(s) ? sp.filter(x => x !== s) : [...sp, s] });
                        }}
                        className={`rounded-full border px-3 py-1 text-xs ${(Array.isArray(item.sports) ? item.sports : []).includes(s) ? "border-primary bg-primary text-primary-foreground" : "border-border hover-elevate"}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <SmallField label="Short description (max 300 chars)">
                  <Textarea rows={2} maxLength={300} value={item.shortDescription || ""} onChange={e => update(item.id, { shortDescription: e.target.value })} />
                </SmallField>
                <div className="space-y-2 pt-6">
                  {kind === "school" && (
                    <>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!item.offersLessons} onCheckedChange={c => update(item.id, { offersLessons: !!c })} /> Lessons</label>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!item.offersRental} onCheckedChange={c => update(item.id, { offersRental: !!c })} /> Rental</label>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LinkedEntityEditor({ kind, spotId, items, setItems, createPath, updatePathPrefix, publishPathPrefix, deletePathPrefix }: {
  kind: "school" | "stay";
  spotId: number;
  items: any[];
  setItems: React.Dispatch<React.SetStateAction<any[]>>;
  createPath: string;
  updatePathPrefix: string;
  publishPathPrefix: string;
  deletePathPrefix: string;
}) {
  const add = async () => {
    const created = await api<any>("POST", createPath, kind === "school"
      ? { spotId, name: "New school", published: false, hasDraft: true }
      : { spotId, name: "New stay", published: false, hasDraft: true });
    setItems(prev => [...prev, created]);
  };
  const patch = async (id: number, patch: any) => {
    const updated = await api<any>("PATCH", `${updatePathPrefix}/${id}`, patch);
    setItems(prev => prev.map(item => item.id === id ? updated : item));
  };
  const publish = async (id: number) => {
    const updated = await api<any>("POST", `${publishPathPrefix}/${id}/publish`);
    setItems(prev => prev.map(item => item.id === id ? updated : item));
  };
  const del = async (id: number) => {
    await api("DELETE", `${deletePathPrefix}/${id}`);
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={add} className="gap-2"><Plus className="h-4 w-4" /> Add {kind}</Button>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No {kind}s yet.</p> : items.map(item => (
        <div key={item.id} className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-medium text-foreground">{item.name}</div>
            <div className="text-xs text-muted-foreground">
              {item.published && !item.hasDraft ? "Published" : item.published ? "Draft edits" : "Draft"}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SmallField label="Name"><Input value={item.name} onChange={e => patch(item.id, { name: e.target.value })} /></SmallField>
            <SmallField label="Website"><Input value={(item as any).websiteUrl || ""} onChange={e => patch(item.id, { websiteUrl: e.target.value })} /></SmallField>
            <SmallField label="Map link"><Input value={(item as any).mapUrl || ""} onChange={e => patch(item.id, { mapUrl: e.target.value })} /></SmallField>
            {kind === "stay" ? <SmallField label="Type"><Input value={(item as any).type || ""} onChange={e => patch(item.id, { type: e.target.value })} /></SmallField> : null}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <SmallField label="Notes"><Textarea rows={2} value={(item as any).notes || ""} onChange={e => patch(item.id, { notes: e.target.value })} /></SmallField>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!(item as any).favorite} onCheckedChange={c => patch(item.id, { favorite: !!c })} /> Favorite</label>
              {kind === "school" ? (
                <>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!(item as any).offersLessons} onCheckedChange={c => patch(item.id, { offersLessons: !!c })} /> Lessons</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!(item as any).offersRental} onCheckedChange={c => patch(item.id, { offersRental: !!c })} /> Rental</label>
                </>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => publish(item.id)}>Publish</Button>
            <Button size="sm" variant="destructive" onClick={() => del(item.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}
