import { useState } from 'react';
import { 
  Bell, 
  BellOff, 
  X, 
  Trash2, 
  Settings, 
  TrendingUp, 
  TrendingDown,
  Activity,
  AlertTriangle,
  Info,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertRule, AlertConfig } from '@/lib/alertTypes';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AlertPanelProps {
  alerts: Alert[];
  config: AlertConfig;
  unreadCount: number;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onToggleRule: (ruleId: string) => void;
  onUpdateConfig: (updates: Partial<AlertConfig>) => void;
}

export function AlertPanel({
  alerts,
  config,
  unreadCount,
  onDismiss,
  onClearAll,
  onToggleRule,
  onUpdateConfig,
}: AlertPanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const getSeverityIcon = (severity: Alert['severity']) => {
    switch (severity) {
      case 'critical':
        return AlertTriangle;
      case 'warning':
        return Activity;
      default:
        return Info;
    }
  };

  const getSeverityColors = (severity: Alert['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-destructive/10 border-destructive/30 text-destructive';
      case 'warning':
        return 'bg-warning/10 border-warning/30 text-warning';
      default:
        return 'bg-primary/10 border-primary/30 text-primary';
    }
  };

  const getCategoryIcon = (category: Alert['category']) => {
    switch (category) {
      case 'market_condition':
        return Activity;
      case 'strategy_signal':
        return TrendingUp;
      default:
        return Bell;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const activeAlerts = alerts.filter(a => a.status === 'triggered');
  const dismissedAlerts = alerts.filter(a => a.status === 'dismissed');

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center animate-pulse">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Alerts & Notifications
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription>
            Real-time market and strategy alerts
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="alerts" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="alerts" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alerts
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="mt-4">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <BellOff className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">No alerts yet</p>
                <p className="text-xs mt-1">Alerts will appear when market conditions or signals change</p>
              </div>
            ) : (
              <>
                {activeAlerts.length > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">Active ({activeAlerts.length})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onClearAll}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Clear All
                    </Button>
                  </div>
                )}
                
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <div className="space-y-2 pr-4">
                    {activeAlerts.map(alert => {
                      const SeverityIcon = getSeverityIcon(alert.severity);
                      const CategoryIcon = getCategoryIcon(alert.category);
                      
                      return (
                        <div
                          key={alert.id}
                          className={cn(
                            "p-3 rounded-lg border transition-all",
                            getSeverityColors(alert.severity)
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1">
                              <SeverityIcon className="h-4 w-4 mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm">{alert.title}</span>
                                  <Badge variant="outline" className="text-xs h-5">
                                    {alert.symbol}
                                  </Badge>
                                </div>
                                <p className="text-xs mt-1 opacity-80">{alert.message}</p>
                                <div className="flex items-center gap-2 mt-2 text-xs opacity-60">
                                  <CategoryIcon className="h-3 w-3" />
                                  <span>{alert.category.replace('_', ' ')}</span>
                                  <span>•</span>
                                  <span>{formatTime(alert.triggeredAt || alert.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => onDismiss(alert.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {dismissedAlerts.length > 0 && (
                      <Collapsible className="mt-4">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="w-full justify-between text-muted-foreground">
                            <span className="text-sm">Dismissed ({dismissedAlerts.length})</span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-2 mt-2">
                          {dismissedAlerts.slice(0, 10).map(alert => (
                            <div
                              key={alert.id}
                              className="p-2 rounded-lg border border-border/50 bg-muted/30 opacity-60"
                            >
                              <div className="flex items-center gap-2">
                                <Check className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium truncate">{alert.title}</span>
                                <Badge variant="outline" className="text-xs h-4 ml-auto">
                                  {alert.symbol}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <div className="space-y-6">
              {/* Global Settings */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Notification Preferences</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Browser Notifications</p>
                      <p className="text-xs text-muted-foreground">Show system notifications</p>
                    </div>
                    <Switch
                      checked={config.browserNotifications}
                      onCheckedChange={(checked) => onUpdateConfig({ browserNotifications: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Sound Alerts</p>
                      <p className="text-xs text-muted-foreground">Play sound on alert</p>
                    </div>
                    <Switch
                      checked={config.soundEnabled}
                      onCheckedChange={(checked) => onUpdateConfig({ soundEnabled: checked })}
                    />
                  </div>
                </div>
              </div>

              {/* Market Condition Rules */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Market Conditions
                </h4>
                {config.rules
                  .filter(r => r.category === 'market_condition')
                  .map(rule => (
                    <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">{rule.description}</p>
                      </div>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => onToggleRule(rule.id)}
                      />
                    </div>
                  ))}
              </div>

              {/* Strategy Signal Rules */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Strategy Signals
                </h4>
                {config.rules
                  .filter(r => r.category === 'strategy_signal')
                  .map(rule => (
                    <div key={rule.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">{rule.description}</p>
                      </div>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => onToggleRule(rule.id)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
