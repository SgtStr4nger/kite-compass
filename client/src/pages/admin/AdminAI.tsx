import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AiSettings, AiEnrichLogEntry } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

const PROMPT_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: "destinationSummary", label: "Destination summary", hint: "Short essence of the spot (1-2 sentences)." },
  { key: "destinationDescription", label: "Destination description", hint: "Full description of the destination (3-5 sentences)." },
  { key: "kiteContextDescription", label: "Kite context", hint: "Wind, water and riding conditions for kitesurfers." },
  { key: "teaserText", label: "Teaser", hint: "Short hook to draw readers in." },
  { key: "transportNote", label: "Transport note", hint: "Practical travel / transport tips." },
  { key: "spotTypes", label: "Spot types", hint: "Enum-restricted (flat-water, waves, lagoon…)." },
  { key: "riderLevels", label: "Rider levels", hint: "Enum-restricted (beginner, intermediate, advanced)." },
  { key: "vibeTags", label: "Vibe tags", hint: "Enum-restricted (city, remote, nightlife…)." },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  success: { label: "Success", className: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Failed", className: "bg-rose-100 text-rose-900" },
  skipped: { label: "Skipped", className: "bg-stone-200 text-stone-700" },
};

export default function AdminAI() {
  const { token, role } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<AiEnrichLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const s = await api<AiSettings>("GET", "/api/admin/ai/settings");
        if (!alive) return;
        setSettings(s);
        setModel(s.model);
        setBaseUrl(s.baseUrl);
        setPrompts(s.prompts);
      } catch (e: any) {
        if (alive) toast({ title: "Could not load AI settings", description: String(e.message || e), variant: "destructive" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistory(await api<AiEnrichLogEntry[]>("GET", "/api/admin/ai/history?limit=50"));
    } catch (e: any) {
      toast({ title: "Could not load AI history", description: String(e.message || e), variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { if (token) void loadHistory(); }, [token]);

  const save = async (clearKey = false) => {
    if (!settings) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (clearKey) body.apiKey = "";
      else if (apiKey.trim()) body.apiKey = apiKey.trim();
      body.model = model.trim();
      body.baseUrl = baseUrl.trim();
      body.prompts = prompts;
      const updated = await api<AiSettings>("PATCH", "/api/admin/ai/settings", body);
      setSettings(updated);
      setModel(updated.model);
      setBaseUrl(updated.baseUrl);
      setPrompts(updated.prompts);
      setApiKey("");
      toast({ title: "AI settings saved" });
    } catch (e: any) {
      toast({ title: "Could not save AI settings", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const isMain = role === "main";
  const hasUnsavedPromptChanges = PROMPT_FIELDS.some(f => (prompts[f.key] ?? "") !== (settings?.prompts?.[f.key] ?? ""));

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">AI content enrichment</h1>
          <p className="text-sm text-muted-foreground">
            Configure the AI provider used by the “Enrich with AI” action on the Spots table.
          </p>
        </div>
      </div>

      {!settings ? (
        loading ? <Skeleton className="h-64 w-full rounded-2xl" /> : null
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Provider connection</CardTitle>
              <p className="text-sm text-muted-foreground">
                Provider: DeepSeek V4 Flash (<code>deepseek-v4-flash</code>). Enrichment writes{" "}
                <strong>drafts</strong> for review and only fills empty fields — it never overwrites
                existing content and never auto-publishes.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {!settings.apiKeySet && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>The Spots “Enrich with AI” action is unavailable until an API key is saved.</span>
                </div>
              )}
              {!isMain && (
                <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
                  Only the main admin can change AI settings.
                </div>
              )}

              <div>
                <Label htmlFor="ai-api-key">API key</Label>
                <Input
                  id="ai-api-key"
                  type="password"
                  value={apiKey}
                  disabled={!isMain || busy}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.apiKeySet ? `••••${settings.apiKeyHint ?? ""} — leave blank to keep` : "sk-…"}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="ai-model">Model</Label>
                <Input
                  id="ai-model"
                  type="text"
                  value={model}
                  disabled={!isMain || busy}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="deepseek-v4-flash"
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="ai-base-url">Base URL</Label>
                <Input
                  id="ai-base-url"
                  type="text"
                  value={baseUrl}
                  disabled={!isMain || busy}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com"
                  className="mt-1.5"
                />
              </div>

              {settings.updatedAt ? (
                <p className="text-xs text-muted-foreground">Last updated: {new Date(settings.updatedAt).toLocaleString()}</p>
              ) : null}

              {isMain && (
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => { void save(false); }}
                    disabled={busy || (!apiKey.trim() && model.trim() === settings.model && baseUrl.trim() === settings.baseUrl && !hasUnsavedPromptChanges)}
                    data-testid="button-save-ai-settings"
                  >
                    <Sparkles className="mr-2 h-4 w-4" /> {busy ? "Saving…" : "Save settings"}
                  </Button>
                  {settings.apiKeySet && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void save(true); }}
                      disabled={busy}
                      data-testid="button-clear-ai-key"
                    >
                      Clear key
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Per-field prompts</CardTitle>
              <p className="text-sm text-muted-foreground">
                Customize the instruction the AI receives for each generated field. Changes take effect on the
                next enrich run. Only fields currently empty on a spot are generated.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {PROMPT_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor={`ai-prompt-${field.key}`}>{field.label}</Label>
                    {!isMain && <span className="text-xs text-muted-foreground">read-only</span>}
                  </div>
                  <textarea
                    id={`ai-prompt-${field.key}`}
                    rows={2}
                    value={prompts[field.key] ?? ""}
                    disabled={!isMain || busy}
                    onChange={(e) => setPrompts(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent AI calls</CardTitle>
                  <p className="text-sm text-muted-foreground">Latest enrichment API calls (newest first).</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => { void loadHistory(); }} disabled={historyLoading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${historyLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI calls recorded yet. Run “Enrich with AI” on the Spots table to see calls here.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-card-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">Spot</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Written</th>
                        <th className="px-4 py-3 font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => {
                        const badge = STATUS_BADGE[row.status] || STATUS_BADGE.skipped;
                        return (
                          <tr key={row.id} className="border-t border-border align-top">
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
                            <td className="px-4 py-3 font-medium">{row.spotName || `#${row.spotId ?? "?"}`}</td>
                            <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span></td>
                            <td className="px-4 py-3 text-muted-foreground">{row.writtenFields.length ? row.writtenFields.join(", ") : "—"}</td>
                            <td className="px-4 py-3 text-rose-600">{row.error ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
