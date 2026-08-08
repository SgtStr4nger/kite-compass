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
import { AiSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, AlertTriangle } from "lucide-react";

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
      } catch (e: any) {
        if (alive) toast({ title: "Could not load AI settings", description: String(e.message || e), variant: "destructive" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const save = async (clearKey = false) => {
    if (!settings) return;
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (clearKey) body.apiKey = "";
      else if (apiKey.trim()) body.apiKey = apiKey.trim();
      body.model = model.trim();
      body.baseUrl = baseUrl.trim();
      const updated = await api<AiSettings>("PATCH", "/api/admin/ai/settings", body);
      setSettings(updated);
      setModel(updated.model);
      setBaseUrl(updated.baseUrl);
      setApiKey("");
      toast({ title: "AI settings saved" });
    } catch (e: any) {
      toast({ title: "Could not save AI settings", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const isMain = role === "main";

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
                    disabled={busy || (!apiKey.trim() && model.trim() === settings.model && baseUrl.trim() === settings.baseUrl)}
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
        </div>
      )}
    </AdminLayout>
  );
}
