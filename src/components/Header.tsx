import { Link } from 'react-router-dom';
import { TrendingUp, BarChart3, Activity, Zap, Search, Globe, Crosshair, Settings, User, Grid3X3 } from 'lucide-react';
import { AlertPanel } from './AlertPanel';
import { Alert, AlertConfig } from '@/lib/alertTypes';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n';

interface HeaderProps {
  alerts?: Alert[];
  alertConfig?: AlertConfig;
  unreadCount?: number;
  lastUpdated?: string | null;
  onDismissAlert?: (id: string) => void;
  onClearAllAlerts?: () => void;
  onToggleAlertRule?: (ruleId: string) => void;
  onUpdateAlertConfig?: (updates: Partial<AlertConfig>) => void;
}

export function Header({
  alerts = [],
  alertConfig,
  unreadCount = 0,
  lastUpdated,
  onDismissAlert,
  onClearAllAlerts,
  onToggleAlertRule,
  onUpdateAlertConfig,
}: HeaderProps) {
  const { lang, setLang, t } = useLanguage();

  const toggleLang = () => {
    setLang(lang === 'en' ? 'zh-TW' : 'en');
  };

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Dan's StockPulse</h1>
                <p className="text-xs text-muted-foreground">{t('appSubtitle')}</p>
              </div>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {/* Screener Link */}
            <Link to="/screener">
              <Button variant="outline" size="sm" className="gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">{t('screener')}</span>
              </Button>
            </Link>

            {/* Tactical Engine Link */}
            <Link to="/tactical">
              <Button variant="outline" size="sm" className="gap-2">
                <Crosshair className="h-4 w-4" />
                <span className="hidden sm:inline">{t('tacticalEngine')}</span>
              </Button>
            </Link>

            {/* Trading Masters Link */}
            <Link to="/masters">
              <Button variant="outline" size="sm" className="gap-2">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Masters</span>
              </Button>
            </Link>

            {/* Master Matrix Link */}
            <Link to="/masters-matrix">
              <Button variant="outline" size="sm" className="gap-2">
                <Grid3X3 className="h-4 w-4" />
                <span className="hidden sm:inline">Matrix</span>
              </Button>
            </Link>

            {/* Settings Link */}
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="gap-2">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>


            <div className="hidden lg:flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Activity className="h-4 w-4 text-success" />
                <span>{t('marketOpen')}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span>{t('tenYearData')}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Zap className="h-4 w-4 text-warning" />
                <span>{t('fiveStrategies')}</span>
              </div>
            </div>

            {lastUpdated && (
              <div className="px-3 py-1.5 bg-secondary rounded-lg text-xs font-mono hidden md:block">
                <span className="text-muted-foreground">{t('lastUpdated')}: </span>
                <span>{new Date(lastUpdated).toLocaleString(lang === 'zh-TW' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}

            {/* Language Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLang}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              title={lang === 'en' ? 'Switch to 繁體中文' : 'Switch to English'}
            >
              <Globe className="h-4 w-4" />
              <span className="text-xs font-medium">{lang === 'en' ? '中文' : 'EN'}</span>
            </Button>

            {alertConfig && onDismissAlert && onClearAllAlerts && onToggleAlertRule && onUpdateAlertConfig && (
              <AlertPanel
                alerts={alerts}
                config={alertConfig}
                unreadCount={unreadCount}
                onDismiss={onDismissAlert}
                onClearAll={onClearAllAlerts}
                onToggleRule={onToggleAlertRule}
                onUpdateConfig={onUpdateAlertConfig}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
