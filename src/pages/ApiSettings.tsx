import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Save, TestTube, Trash2,
} from 'lucide-react';
import { BackToTop } from '@/components/BackToTop';
import * as storage from '@/lib/storage';

const STORAGE_KEY = 'stockpulse_api_config';

// ─── Types ─────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string;
  label: string;
  description: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: 'url' | 'key' | 'text';
  placeholder: string;
  required?: boolean;
}

interface StoredConfig {
  [providerId: string]: { [fieldKey: string]: string };
}

// ─── Provider definitions ──────────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'finnhub',
    label: 'Finnhub',
    description: 'Stock quotes, company profiles, metrics, and news. Free tier: 60 calls/min.',
    fields: [
      { key: 'api_key', label: 'API key', type: 'key', placeholder: 'cn(...)', required: true },
      { key: 'api_key_2', label: 'API key #2 (optional, for rotation)', type: 'key', placeholder: 'cn(...)' },
    ],
  },
  {
    id: 'twelvedata',
    label: 'Twelve Data',
    description: 'Stock quotes and historical OHLCV candles. Free tier: 800 calls/day.',
    fields: [
      { key: 'api_key', label: 'API key', type: 'key', placeholder: '(...)', required: true },
    ],
  },
];

// ─── Storage helpers ───────────────────────────────────────────────

function loadConfig(): StoredConfig {
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(cfg: StoredConfig) {
  storage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function getApiConfig(): StoredConfig {
  return loadConfig();
}

export function getApiKey(providerId: string, fieldKey: string): string {
  return loadConfig()[providerId]?.[fieldKey] ?? '';
}

// ─── Component ─────────────────────────────────────────────────────

export default function ApiSettings() {
  const [config, setConfig] = useState<StoredConfig>(loadConfig);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const updateField = (providerId: string, fieldKey: string, value: string) => {
    setConfig(prev => ({
      ...prev,
      [providerId]: { ...(prev[providerId] || {}), [fieldKey]: value },
    }));
  };

  const handleSave = useCallback(async (providerId: string) => {
    setSaving(providerId);
    try {
      const cfg = config[providerId] || {};
      saveConfig({ ...config, [providerId]: cfg });
      toast.success(`${providerId} saved locally`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [config]);

  const handleClear = (providerId: string) => {
    const updated = { ...config };
    delete updated[providerId];
    setConfig(updated);
    saveConfig(updated);
    toast.success(`${providerId} cleared`);
  };

  const handleTest = useCallback(async (providerId: string) => {
    setTesting(providerId);
    try {
      if (providerId === 'finnhub') {
        const keys = [
          { label: 'Key #1', value: config.finnhub?.api_key },
          { label: 'Key #2', value: config.finnhub?.api_key_2 },
        ].filter(k => k.value && k.value.trim());
        if (keys.length === 0) throw new Error('At least one API key required');

        const results: string[] = [];
        for (const k of keys) {
          const token = k.value.trim();
          try {
            const q = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${token}`).then(r => r.json()).catch(() => null);
            const price = q && q.c ? `$${q.c}` : 'no quote';
            let earn = 'n/a';
            try {
              const eRes = await fetch(`https://finnhub.io/api/v1/stock/earnings-surprises?symbol=AAPL&token=${token}`);
              const eText = await eRes.text();
              const isHtml = /^\s*(<!DOCTYPE|<html)/i.test(eText);
              if (eRes.ok && !isHtml) {
                const arr = JSON.parse(eText);
                earn = Array.isArray(arr) && arr.length ? `earn ${arr.length}q` : 'earn 0q';
              } else if (eRes.status === 429) {
                earn = 'earn rate-limited';
              } else {
                earn = 'earn blocked';
              }
            } catch {
              earn = 'earn failed';
            }
            results.push(`${k.label}: ${price}, ${earn}`);
          } catch (e) {
            results.push(`${k.label}: ${e instanceof Error ? e.message : 'failed'}`);
          }
        }
        toast.success(`Finnhub — ${results.join('  |  ')}`);
      } else if (providerId === 'twelvedata') {
        const key = config.twelvedata?.api_key;
        if (!key) throw new Error('API key required');
        const res = await fetch(`https://api.twelvedata.com/quote?symbol=AAPL&apikey=${key}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.close) {
          toast.success(`Twelve Data OK — AAPL $${data.close}`);
        } else {
          toast.warning(data.message || 'Connected but no data');
        }
      }
    } catch (e) {
      toast.error(`Test failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setTesting(null);
    }
  }, [config]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Link to="/settings">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">API Keys &amp; URLs</h1>
        </div>

        {PROVIDERS.map((provider) => {
          const cfg = config[provider.id] || {};
          const hasAllRequired = provider.fields
            .filter(f => f.required)
            .every(f => cfg[f.key]?.trim());

          return (
            <Card key={provider.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <KeyRound className="h-4 w-4 text-primary" />
                      {provider.label}
                    </CardTitle>
                    <CardDescription className="mt-1">{provider.description}</CardDescription>
                  </div>
                  {hasAllRequired
                    ? <Badge className="text-[10px]">configured</Badge>
                    : <Badge variant="outline" className="text-[10px]">not set</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {provider.fields.map((field) => {
                  const showKey = showKeys[`${provider.id}.${field.key}`];
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-xs flex items-center gap-1.5">
                        {field.label}
                        {field.required && <span className="text-destructive">*</span>}
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={field.type === 'key' && !showKey ? 'password' : field.type === 'url' ? 'url' : 'text'}
                            value={cfg[field.key] ?? ''}
                            onChange={(e) => updateField(provider.id, field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="pr-8 font-mono text-sm"
                          />
                          {field.type === 'key' && (
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onClick={() => setShowKeys(p => ({ ...p, [`${provider.id}.${field.key}`]: !p[`${provider.id}.${field.key}`] }))}
                            >
                              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleSave(provider.id)}
                    disabled={saving === provider.id}
                  >
                    {saving === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleTest(provider.id)}
                    disabled={testing === provider.id || !hasAllRequired}
                  >
                    {testing === provider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
                    Test connection
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground hover:text-destructive"
                    onClick={() => handleClear(provider.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Separator />

        <div className="text-center space-y-1">
          <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
            Back to Settings
          </Link>
        </div>
      </div>
      <BackToTop />
    </div>
  );
}
