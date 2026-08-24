import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  ArrowLeft, Download, Database, FileDown, FileUp, FolderOpen, Loader2, LogOut, Mail, Plus, ShieldCheck, Star, Trash2, Upload, User,
  KeyRound, Cloud, CloudUpload, CloudDownload, PlugZap, Copy,
} from 'lucide-react';
import { BackToTop } from '@/components/BackToTop';
import { popularStocks } from '@/lib/stockData';
import * as storage from '@/lib/storage';
import { exportDb, importDb, importCsv, getStats, isFsAccessSupported, pickDbFile, resetDbFile, getDbFileName, clearSymbol } from '@/lib/localDb';
import {
  getSupabaseConfig, saveSupabaseConfig, testConnection, pushKeys, pullAll, SETUP_SQL, TABLE,
} from '@/lib/supabaseDb';

const WATCHLIST_KEY = 'stockpulse_watchlist';
const AUTH_KEY = 'stockpulse_auth';
const USERS_KEY = 'stockpulse_users';

async function hashPassword(pw: string): Promise<string> {
  const data = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredWatchlist(): string[] {
  try {
    return JSON.parse(storage.getItem(WATCHLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWatchlist(symbols: string[]) {
  storage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
}

interface StoredUser {
  email: string;
  passwordHash: string;
  id: string;
}

interface SessionInfo {
  email: string;
  id: string;
}

function getUsers(): StoredUser[] {
  try {
    return JSON.parse(storage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  storage.setItem(USERS_KEY, JSON.stringify(users));
}

function getSession(): SessionInfo | null {
  try {
    return JSON.parse(storage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

function setSession(s: SessionInfo | null) {
  if (s) storage.setItem(AUTH_KEY, JSON.stringify(s));
  else storage.removeItem(AUTH_KEY);
}

export default function Settings() {
  const [session, setSessionState] = useState<SessionInfo | null>(getSession);
  const [loading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authLoading, setAuthLoading] = useState(false);

  const [watchlist, setWatchlist] = useState<string[]>(getStoredWatchlist);
  const [newSymbol, setNewSymbol] = useState('');
  const [dbStats, setDbStats] = useState<{ quotes: number; historical: number; file: string | null }>({ quotes: 0, historical: 0, file: null });
  const [dbLoading, setDbLoading] = useState(false);

  // Supabase cloud sync
  const [sbUrl, setSbUrl] = useState(getSupabaseConfig().url);
  const [sbKey, setSbKey] = useState(getSupabaseConfig().anonKey);
  const [sbEnabled, setSbEnabled] = useState(getSupabaseConfig().enabled);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbStatus, setSbStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    getStats().then(setDbStats);
  }, []);

  const handleAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const users = getUsers();
      const emailLower = email.trim().toLowerCase();

      if (authMode === 'signup') {
        if (users.find(u => u.email === emailLower)) {
          throw new Error('An account with this email already exists');
        }
        const passwordHash = await hashPassword(password);
        const id = crypto.randomUUID();
        const user: StoredUser = { email: emailLower, passwordHash, id };
        users.push(user);
        saveUsers(users);
        const sess: SessionInfo = { email: emailLower, id };
        setSession(sess);
        setSessionState(sess);
        toast.success('Account created and signed in');
      } else {
        const user = users.find(u => u.email === emailLower);
        if (!user) throw new Error('No account found with this email');
        const passwordHash = await hashPassword(password);
        if (user.passwordHash !== passwordHash) throw new Error('Incorrect password');
        const sess: SessionInfo = { email: emailLower, id: user.id };
        setSession(sess);
        setSessionState(sess);
        toast.success('Signed in successfully');
      }
      setEmail('');
      setPassword('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Auth failed');
    } finally {
      setAuthLoading(false);
    }
  }, [authMode, email, password]);

  const handleSignOut = useCallback(() => {
    setSession(null);
    setSessionState(null);
    toast.success('Signed out');
  }, []);

  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    if (watchlist.includes(sym)) {
      toast.info(`${sym} is already in your watchlist`);
      return;
    }
    const updated = [...watchlist, sym];
    setWatchlist(updated);
    saveWatchlist(updated);
    setNewSymbol('');
    toast.success(`Added ${sym} to watchlist`);
  };

  const removeSymbol = (sym: string) => {
    const updated = watchlist.filter((s) => s !== sym);
    setWatchlist(updated);
    saveWatchlist(updated);
  };

  const stockLookup = (sym: string) =>
    popularStocks.find((s) => s.symbol === sym);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> StockPulse
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        </div>

        {/* Auth Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" /> Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            {session ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{session.email}</p>
                    <p className="text-xs text-muted-foreground font-mono">{session.id}</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto">Signed in</Badge>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4" /> Sign out
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2 text-sm">
                  <Button
                    variant={authMode === 'login' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setAuthMode('login')}
                  >
                    Sign in
                  </Button>
                  <Button
                    variant={authMode === 'signup' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setAuthMode('signup')}
                  >
                    Sign up
                  </Button>
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="email" className="text-xs flex items-center gap-1.5">
                      <Mail className="h-3 w-3" /> Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="password" className="text-xs">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleAuth}
                    disabled={authLoading || !email || !password}
                  >
                    {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === 'login' ? 'Sign in' : 'Create account'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Watchlist Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-primary" /> Watchlist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add symbol (e.g. AAPL)"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                className="uppercase"
                maxLength={10}
              />
              <Button size="sm" className="gap-1.5" onClick={addSymbol} disabled={!newSymbol.trim()}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>

            {watchlist.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Your watchlist is empty. Add a stock symbol above.
              </p>
            ) : (
              <div className="space-y-2">
                {watchlist.map((sym) => {
                  const info = stockLookup(sym);
                  return (
                    <div
                      key={sym}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-sm">{sym}</span>
                        {info ? (
                          <span className="text-xs text-muted-foreground">{info.name}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">unknown symbol</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {info && (
                          <Badge variant={info.changePercent >= 0 ? 'default' : 'destructive'} className="text-[10px] font-mono">
                            {info.changePercent >= 0 ? '+' : ''}{info.changePercent.toFixed(2)}%
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeSymbol(sym)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Database Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" /> SQLite Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {dbStats.file ? `File: ${dbStats.file}` : 'Storage: IndexedDB (browser only)'}
                </span>
                {isFsAccessSupported() && (
                  <Badge variant={dbStats.file ? 'default' : 'secondary'} className="text-[10px]">
                    {dbStats.file ? 'On disk' : 'In browser'}
                  </Badge>
                )}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{dbStats.quotes} quotes cached</span>
                <span>{dbStats.historical} historical rows</span>
              </div>
            </div>

            {isFsAccessSupported() ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={dbLoading}
                  onClick={async () => {
                    setDbLoading(true);
                    try {
                      const ok = await pickDbFile();
                      if (ok) toast.success('Database file linked — data persists to disk');
                      else toast.info('No file selected');
                      const s = await getStats();
                      setDbStats(s);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed');
                    } finally {
                      setDbLoading(false);
                    }
                  }}
                >
                  {dbStats.file ? <FolderOpen className="h-3.5 w-3.5" /> : <FileDown className="h-3.5 w-3.5" />}
                  {dbStats.file ? 'Change file location' : 'Save DB to disk'}
                </Button>
                {dbStats.file && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={dbLoading}
                    onClick={async () => {
                      setDbLoading(true);
                      try {
                        await resetDbFile();
                        const s = await getStats();
                        setDbStats(s);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      } finally {
                        setDbLoading(false);
                      }
                    }}
                  >
                    <FileUp className="h-3.5 w-3.5" /> Pick different file
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                File System Access API not available in this browser. Data stored in IndexedDB only.
              </p>
            )}

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { exportDb(); toast.success('Downloading .db file'); }}>
                <Download className="h-3.5 w-3.5" /> Export .db
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.db,.sqlite,.sqlite3';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    setDbLoading(true);
                    try {
                      await importDb(file);
                      toast.success(`Imported ${file.name}`);
                      const s = await getStats();
                      setDbStats(s);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Import failed');
                    } finally {
                      setDbLoading(false);
                    }
                  };
                  input.click();
                }}
                disabled={dbLoading}
              >
                {dbLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Import .db
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.csv';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    setDbLoading(true);
                    try {
                      const result = await importCsv(file);
                      toast.success(`Imported ${result.count} ${result.type} rows from ${file.name}`);
                      const s = await getStats();
                      setDbStats(s);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'CSV import failed');
                    } finally {
                      setDbLoading(false);
                    }
                  };
                  input.click();
                }}
                disabled={dbLoading}
              >
                {dbLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Import CSV
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  setDbLoading(true);
                  try {
                    await clearSymbol();
                    toast.success('Quote cache cleared — data will refresh on next load');
                    const s = await getStats();
                    setDbStats(s);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Clear failed');
                  } finally {
                    setDbLoading(false);
                  }
                }}
                disabled={dbLoading}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear Cache
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Supabase Cloud Sync Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="h-4 w-4 text-primary" /> Cloud Sync (Supabase)
              {sbEnabled && sbStatus === 'ok' && (
                <Badge variant="default" className="ml-auto text-[10px]">Connected</Badge>
              )}
              {sbStatus === 'error' && (
                <Badge variant="destructive" className="ml-auto text-[10px]">Error</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Optional third storage layer. When enabled, all settings and documents
              (watchlist, users, screener results, politician trades, alerts, cron history…)
              are mirrored to a Supabase table <span className="font-mono">{TABLE}</span> with a 3-second debounce.
              Configure it below, run the setup SQL once in your Supabase project, then test the connection.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sb-url" className="text-xs">Project URL</Label>
                <Input
                  id="sb-url"
                  type="url"
                  placeholder="https://xxxxx.supabase.co"
                  value={sbUrl}
                  onChange={(e) => setSbUrl(e.target.value.trim())}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sb-key" className="text-xs flex items-center gap-1.5">
                  <KeyRound className="h-3 w-3" /> Anon (public) key
                </Label>
                <Input
                  id="sb-key"
                  type="password"
                  placeholder="eyJhbGciOi..."
                  value={sbKey}
                  onChange={(e) => setSbKey(e.target.value.trim())}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Enable cloud sync</p>
                  <p className="text-xs text-muted-foreground">Writes mirror to Supabase automatically</p>
                </div>
                <Switch
                  checked={sbEnabled}
                  onCheckedChange={(checked) => {
                    if (checked && (!sbUrl || !sbKey)) {
                      toast.error('Enter Project URL and Anon key first');
                      return;
                    }
                    setSbEnabled(checked);
                    saveSupabaseConfig({ url: sbUrl, anonKey: sbKey, enabled: checked });
                    setSbStatus('unknown');
                    toast.success(checked ? 'Cloud sync enabled' : 'Cloud sync disabled');
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!sbUrl || !sbKey || sbLoading}
                onClick={() => {
                  saveSupabaseConfig({ url: sbUrl, anonKey: sbKey, enabled: sbEnabled });
                  setSbStatus('unknown');
                  toast.success('Supabase credentials saved');
                }}
              >
                Save credentials
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={sbLoading || !sbUrl || !sbKey}
                onClick={() => {
                  saveSupabaseConfig({ url: sbUrl, anonKey: sbKey, enabled: sbEnabled });
                  setSbLoading(true);
                  toast.promise(testConnection(), {
                    loading: 'Testing connection...',
                    success: (res) => {
                      setSbStatus(res.ok ? 'ok' : 'error');
                      if (res.ok) return `Connected — table ${TABLE} is reachable`;
                      throw new Error(res.error ?? 'Connection failed');
                    },
                    error: (e) => {
                      setSbStatus('error');
                      return e instanceof Error ? e.message : 'Connection failed';
                    },
                    finally: () => setSbLoading(false),
                  });
                }}
              >
                {sbLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                Test connection
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!sbEnabled || sbLoading}
                onClick={() => {
                  saveSupabaseConfig({ url: sbUrl, anonKey: sbKey, enabled: sbEnabled });
                  setSbLoading(true);
                  toast.promise(pushKeys(), {
                    loading: 'Pushing local data to cloud...',
                    success: (n) => `Pushed ${n} keys to Supabase`,
                    error: (e) => (e instanceof Error ? e.message : 'Push failed'),
                    finally: () => setSbLoading(false),
                  });
                }}
              >
                <CloudUpload className="h-3.5 w-3.5" /> Push now
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!sbEnabled || sbLoading}
                onClick={() => {
                  saveSupabaseConfig({ url: sbUrl, anonKey: sbKey, enabled: sbEnabled });
                  setSbLoading(true);
                  toast.promise(pullAll(), {
                    loading: 'Pulling cloud data to local...',
                    success: (n) => `Pulled ${n} keys from Supabase`,
                    error: (e) => (e instanceof Error ? e.message : 'Pull failed'),
                    finally: () => setSbLoading(false),
                  });
                }}
              >
                <CloudDownload className="h-3.5 w-3.5" /> Pull now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSql(!showSql)}
              >
                {showSql ? 'Hide' : 'Show'} setup SQL
              </Button>
            </div>

            {showSql && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground overflow-x-auto">
                  {SETUP_SQL}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(SETUP_SQL);
                    toast.success('SQL copied to clipboard');
                  }}
                >
                  <Copy className="h-3 w-3" /> Copy SQL
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-center gap-6 text-xs text-muted-foreground">
          <Link to="/api-settings" className="hover:text-foreground flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> API Keys &amp; URLs
          </Link>
          <Link to="/admin" className="hover:text-foreground">
            Ops Console (admin)
          </Link>
        </div>
      </div>
      <BackToTop />
    </div>
  );
}
