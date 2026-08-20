import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  Activity, ArrowLeft, Clock, Loader2, LogOut, Play, RefreshCw, ShieldCheck, Zap,
} from 'lucide-react';
import { BackToTop } from '@/components/BackToTop';
import * as storage from '@/lib/storage';
import {
  CRON_JOBS, getJobStatuses, triggerJob, toggleJob, getRunHistory,
  type CronJob, type CronRun,
} from '@/lib/localCron';

const PASSWORD_KEY = 'stockpulse_admin_pw';
const ADMIN_AUTH_KEY = 'stockpulse_admin_auth';

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function hashPassword(pw: string): Promise<string> {
  const data = new TextEncoder().encode(pw);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredAdminHash(): string | null {
  return storage.getItem(ADMIN_AUTH_KEY);
}

function setStoredAdminHash(hash: string) {
  storage.setItem(ADMIN_AUTH_KEY, hash);
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(() => !!getStoredAdminHash());
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
  const [input, setInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [jobStatuses, setJobStatuses] = useState(() => getJobStatuses());
  const [history, setHistory] = useState<CronRun[]>(() => getRunHistory());

  const handleLogin = useCallback(async () => {
    setAuthError('');
    setLoading(true);
    try {
      const stored = getStoredAdminHash();
      const inputHash = await hashPassword(input);

      if (!stored) {
        setStoredAdminHash(inputHash);
        setPassword(input);
        sessionStorage.setItem(PASSWORD_KEY, input);
        setAuthenticated(true);
        toast.success('Admin password set');
      } else if (inputHash === stored) {
        setPassword(input);
        sessionStorage.setItem(PASSWORD_KEY, input);
        setAuthenticated(true);
      } else {
        setAuthError('Incorrect password');
      }
      setInput('');
    } finally {
      setLoading(false);
    }
  }, [input]);

  const handleSignOut = useCallback(() => {
    storage.removeItem(ADMIN_AUTH_KEY);
    sessionStorage.removeItem(PASSWORD_KEY);
    setAuthenticated(false);
    setPassword('');
  }, []);

  const refreshJobs = useCallback(() => {
    setJobStatuses(getJobStatuses());
    setHistory(getRunHistory());
  }, []);

  useEffect(() => {
    const id = setInterval(refreshJobs, 30_000);
    return () => clearInterval(id);
  }, [refreshJobs]);

  const runFunction = async (jobId: string) => {
    setRunning(jobId);
    try {
      const run = await triggerJob(jobId);
      toast[run.ok ? 'success' : 'error'](
        `${jobId}: ${run.ok ? 'ok' : run.error ?? 'failed'} in ${fmtDuration(run.durationMs)}`,
      );
      refreshJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(null);
    }
  };

  const handleToggle = useCallback((jobId: string, enabled: boolean) => {
    toggleJob(jobId, enabled);
    refreshJobs();
  }, [refreshJobs]);

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" /> Admin access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">Admin password</Label>
              <Input
                id="pw"
                type="password"
                value={input}
                onChange={(e) => { setInput(e.target.value); setAuthError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
              />
              {authError && <p className="text-xs text-destructive">{authError}</p>}
              {!getStoredAdminHash() && (
                <p className="text-xs text-muted-foreground">First time? Enter a new password to set it.</p>
              )}
            </div>
            <Button className="w-full" onClick={handleLogin} disabled={!input}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unlock'}
            </Button>
            <Link to="/" className="block text-center text-xs text-muted-foreground hover:text-foreground">
              Back to StockPulse
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> StockPulse
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Ops Console</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Local scheduler active</span>
            <Button variant="outline" size="sm" className="gap-2" onClick={refreshJobs}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>

        {/* Scheduled jobs — local cron */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Scheduled tasks (local cron)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobStatuses.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{j.label}</span>
                    {j.enabled
                      ? <Badge className="text-[10px]">enabled</Badge>
                      : <Badge variant="destructive" className="text-[10px]">disabled</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{j.schedule} UTC</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Last: {j.lastRun ? fmtTime(j.lastRun.startedAt) : 'never'}
                      {j.lastRun && (
                        <Badge variant={j.lastRun.ok ? 'default' : 'destructive'} className="ml-1 text-[10px]">
                          {j.lastRun.ok ? 'ok' : 'failed'}
                        </Badge>
                      )}
                    </span>
                    <span>Next: {j.nextRun ? fmtTime(j.nextRun.toISOString()) : '—'}</span>
                    {j.lastRun && <span>Duration: {fmtDuration(j.lastRun.durationMs)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={j.enabled}
                    onCheckedChange={(checked) => handleToggle(j.id, checked)}
                  />
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={running === j.id}
                    onClick={() => runFunction(j.id)}
                  >
                    {running === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run now
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent run history */}
        {history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent run history</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Job</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().slice(0, 20).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 pr-4 text-xs">{fmtTime(r.startedAt)}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.jobId}</td>
                      <td className="py-1.5 pr-4 text-xs">{fmtDuration(r.durationMs)}</td>
                      <td className="py-1.5 pr-4 text-xs">
                        {r.ok
                          ? <span className="text-success">ok (HTTP {r.status})</span>
                          : <span className="text-destructive">{r.error ?? 'failed'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Separator />

        <div className="text-center">
          <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
            Settings
          </Link>
        </div>
      </div>
      <BackToTop />
    </div>
  );
}
