import { useEffect, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { SpotDetail, MonthlyRecord, MONTHS, tagLabel } from "@/lib/types";
import { ArrowLeft, Eye, Save, Trash2, Upload, Plus, CloudDownload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

const SPOT_TYPES = ["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"];
const RIDER_LEVELS = ["beginner", "intermediate", "advanced"];
const VIBE_TAGS = ["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"];
const SEASONS = ["peak", "good", "okay", "off"];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
    sourceNotes: "", internalNotes: "", rankingMode: "manual",
    published: false, hasDraft: true,
  });
  const [monthly, setMonthly] = useState<MonthlyRecord[]>([]);
  const [savedId, setSavedId] = useState<number | null>(id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded) {
      const { monthly: m, ...rest } = loaded;
      setForm(rest);
      setMonthly(m);
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

  // ── Monthly record helpers ──
  const usedMonths = monthly.map(m => m.month);
  const addMonth = async (month: string) => {
    if (!savedId) { toast({ title: "Save the spot first", variant: "destructive" }); return; }
    const rec = await api<MonthlyRecord>("POST", "/api/admin/monthly", {
      spotId: savedId, month, seasonLabel: "good", published: false, hasDraft: true,
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
  const deleteMonth = async (mid: number) => {
    await api("DELETE", `/api/admin/monthly/${mid}`);
    setMonthly(ms => ms.filter(m => m.id !== mid));
  };

  return (
    <AdminLayout>
      {/* header / action bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate("/admin/spots")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-admin">
          <ArrowLeft className="h-4 w-4" /> All spots
        </button>
        <div className="flex items-center gap-2">
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

        {/* Descriptions */}
        <Section title="Descriptions">
          <Field label="Teaser" hint="Short line shown on result cards (editable, stored separately)"><Textarea rows={2} value={form.teaserText || ""} onChange={e => set("teaserText", e.target.value)} data-testid="input-teaser" /></Field>
          <Field label="Summary" hint="One-liner at the top of the spot page"><Textarea rows={2} value={form.destinationSummary || ""} onChange={e => set("destinationSummary", e.target.value)} data-testid="input-summary" /></Field>
          <Field label="Destination description"><Textarea rows={4} value={form.destinationDescription || ""} onChange={e => set("destinationDescription", e.target.value)} data-testid="input-destdesc" /></Field>
          <Field label="Kite context description"><Textarea rows={4} value={form.kiteContextDescription || ""} onChange={e => set("kiteContextDescription", e.target.value)} data-testid="input-kitedesc" /></Field>
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
              <p className="text-sm text-muted-foreground">Manual uses the score you enter per month. Automatic (future) will derive it from wind inputs.</p>
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
        <SmallField label="Avg wind (kn)">
          <Input type="number" step="any" value={rec.averageBaseWind ?? ""} onChange={e => onChange({ averageBaseWind: num(e.target.value) })} data-testid={`input-avgwind-${rec.month}`} />
        </SmallField>
        <SmallField label="Gusts (kn)">
          <Input type="number" step="any" value={rec.gusts ?? ""} onChange={e => onChange({ gusts: num(e.target.value) })} data-testid={`input-gusts-${rec.month}`} />
        </SmallField>
        <SmallField label="Wind days">
          <Input type="number" value={rec.windDays ?? ""} onChange={e => onChange({ windDays: num(e.target.value) })} data-testid={`input-winddays-${rec.month}`} />
        </SmallField>
        <SmallField label="Season">
          <select value={rec.seasonLabel} onChange={e => onChange({ seasonLabel: e.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid={`select-season-${rec.month}`}>
            {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </SmallField>
        {autoMode && (
          <SmallField label="Auto score">
            <Input type="number" step="0.1" value={rec.automaticWindScore ?? ""} disabled title="Reserved for the future automatic wind score" />
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
